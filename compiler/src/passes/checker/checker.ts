/**
 * The checker implements the Hindley–Milner core needed by the current vertical
 * slices. Mutable union-find variables are private to inference; type variables
 * written in annotations are rigid while their definition is checked. The
 * returned Typed tree contains only immutable types and schemes. Implied
 * type choices substitute into ground instances and erase before emission; v1
 * rejects projection-bearing constraints on type-variable binders.
 */

import { IMPURE_ARROW, linkedArrow, PURE_ARROW } from "../../support/arrows.js";
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
import {
  declaredConstraintIdentity,
  isPreRegisteredIdentity,
  mintBaseConstraintSlots,
  PRE_REGISTERED_BASE_CONSTRAINTS,
  PRE_REGISTERED_CONSTRAINT_MEMBERS,
  PRE_REGISTERED_CONSTRAINTS,
  preRegisteredConstraintIdentity,
  STRUCTURAL_CONSTRAINTS,
} from "../../constraints.js";
import { isIntrinsicScheme } from "../../intrinsics.js";
import { PRIMITIVE_COMPANION_BASENAMES } from "../../prelude.js";
import { relativeFilePath, relativeSpecifier } from "../../support/paths.js";
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
  /**
   * Every nominal's companion operation set as its **home module** declared it,
   * for the modules the program has compiled so far (#585, `homeCompanionOperations`).
   *
   * Method Syntax §4.2's set is import-insensitive by construction, and this is
   * the construction: the checker reads a receiver's operations from here rather
   * than from its own symbol table, which holds only what this module's imports
   * happened to carry. Absent — a lone `check` in a test — the module's own view
   * stands, which is complete for a single-module program.
   */
  readonly programOperations?: ProgramOperations;
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
  | EffectConstant
  | Constructor
  | TupleMono
  | RecordMono
  | RangeMono
  | VectorMono
  | MapMono
  | SetMono
  | ArrayMono
  | JsMapMono
  | JsSetMono
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
   * Where an **ascription** declared this variable — the written type's span
   * (Ascription §3.1). Present only when the ascription is where the name was
   * first written in its declaration; a variable a binder or a parameter
   * annotation declared and an ascription merely re-names keeps `undefined`,
   * because it is that binder's variable.
   *
   * Functions §8's arms key on an annotated binding's declared variable, and a
   * right-hand-side ascription now declares one where the binder has no
   * annotation of its own — declaredness, not the binder's punctuation, is the
   * key (edit note, Ascription §8). This is how those arms find the span to
   * report at.
   */
  readonly ascribedAt?: Source.Span;
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
  /**
   * The declarations this variable has already refused a demand for, keyed on
   * **identity** (#716): two constraints sharing a word are two refusals, and a
   * name-keyed set silently swallowed the second.
   */
  readonly rejectedConstraints: Set<string>;
}

interface Constructor {
  readonly kind: "Constructor";
  readonly name: Typed.PrimitiveName;
}

interface FunctionMono {
  readonly kind: "Function";
  readonly parameters: readonly Mono[];
  readonly result: Mono;
  /**
   * The arrow's colour (#355). Absent means the pure constant, which is what
   * every arrow this compiler builds with the flag off means and what it has
   * always meant — so an absent slot needs no migration and reads correctly.
   *
   * The slot holds an ordinary `Mono`: either `EffectConstant` or a `Variable`.
   * That is ruling 3 taken literally — effect variables *are* type variables,
   * so unification, pruning, the occurs check, generalization, and
   * instantiation reach them by walking the structure they already walk, and
   * there is one law rather than two.
   */
  readonly effect?: Mono;
}

/**
 * One of the two points of the effect lattice, as a `Mono` so it inhabits the
 * effect slot beside a variable. Purity is *not* a lattice point the solver
 * ever has to order: a pure function fits an impure expectation because the
 * expectation is a variable and instantiation binds it, which is the whole
 * mechanism (`purity-as-polymorphism`).
 */
interface EffectConstant {
  readonly kind: "Effect";
  readonly impure: boolean;
  /**
   * Set only on §4.4's recovery constant. A refused `->?` still recovers as the
   * impure constant so the rest of the body stays checkable, and the recovery
   * carries this tell so the obligations it feeds can be suppressed: the one
   * §4.4 report is the ruling, and the constant is scaffolding rather than a
   * claim to re-litigate downstream.
   */
  readonly recovered?: boolean;
}

const PURE: EffectConstant = { kind: "Effect", impure: false };
const IMPURE: EffectConstant = { kind: "Effect", impure: true };
/** §4.4's marked recovery — the impure constant, and known to be one. */
const RECOVERED: EffectConstant = { kind: "Effect", impure: true, recovered: true };

/**
 * Whether a colour is the impure constant, by value rather than by identity:
 * §4.4's recovery is a second impure constant object, and every arm that asks
 * "is this impure?" means both of them.
 */
function isImpure(colour: Mono): boolean {
  return colour.kind === "Effect" && colour.impure;
}

/** Whether a colour is §4.4's recovery, so what it feeds is already reported. */
function isRecovered(colour: Mono): boolean {
  return colour.kind === "Effect" && colour.recovered === true;
}

/**
 * One signature's shared effect variable and every `->?` written for it
 * (#355: "one implicitly quantified effect variable per signature, all
 * occurrences, no exceptions").
 *
 * The arrow spans are kept for ruling 9's face report, which needs tokens to put
 * a fixit on: every written occurrence spells this one variable, and §4.2 has
 * the fixit rewrite all of them except where the join decides otherwise — an
 * impure solution with a written outer arrow repairs that arrow alone.
 * `outer` is present only where the signature's outermost
 * arrow was written — a binding annotation or an extern face. Hexagon's
 * declaration form has no outer arrow at all (`let f(x: A): B = …` ends at `=`),
 * so a declaration-form function's colour is inferred; the report then stands at
 * the first arrow that *was* written, and only a signature with none at all
 * falls back to `declaration` and to advice in words.
 */
interface SignatureFace {
  readonly effect: Variable;
  readonly arrows: Source.Span[];
  outer?: Source.Span | undefined;
  /** Where to report when no arrow token is available. */
  readonly declaration: Source.Span;
}

/**
 * One function body's effect seat: the colour of its own arrow, the calls it
 * has to absorb, and whether its signature gives a `?` anywhere to join.
 */
interface EffectFrame {
  /** The lambda's own arrow colour — the same variable as the signature's when linked. */
  readonly own: Mono;
  /**
   * Whether this body has an inlet: a `->?` in parameter position, here or in
   * an enclosing signature. Without one there is no colour for a `?` to
   * conduct, so an unsolved colour in this body defaults pure instead.
   */
  readonly inlet: boolean;
  readonly enclosing: EffectFrame | undefined;
  /** Call colours awaiting `own ⊒ colour`, settled after inference. */
  readonly absorbed: { readonly effect: Mono; readonly span: Source.Span }[];
  /** Set when an absorbed colour was the impure *constant* — ruling 9's tell. */
  sourced: boolean;
}

/** One written call, and the mark it wore, awaiting its solved colour. */
interface MarkObligation {
  readonly effect: Mono;
  readonly mark: "bang" | "question" | undefined;
  /** The written mark's own span, for a fixit that deletes or replaces it. */
  readonly markSpan: Source.Span | undefined;
  /** Where an absent mark would be inserted: immediately before the argument list. */
  readonly insertAt: Source.Span;
  readonly span: Source.Span;
  readonly frame: EffectFrame | undefined;
  readonly callee: string;
}

/**
 * Whether an annotation writes a linked `->?` **anywhere** inside it, at any
 * depth and any polarity. `->!` does not count: it is the constant, so it links
 * nothing and offers no inlet.
 *
 * This is the position-*blind* walk. §2.2.1's inlet test asks it of one
 * parameter type at a time — where depth and polarity really are irrelevant,
 * because the caller supplies the whole argument value — and `signatureInlet`
 * below is what chooses those parameter types. Asking it of a whole signature
 * would count a spine arrow's own colour and a terminal result's, which are
 * exactly the two occurrences no caller can pin.
 */
function annotationWritesLinkedArrow(annotation: Resolved.TypeAnnotation): boolean {
  let found = false;
  const walk = (node: unknown): void => {
    if (found || node === null || typeof node !== "object") return;
    if (Array.isArray(node)) {
      for (const child of node) walk(child);
      return;
    }
    const record = node as { kind?: unknown; effect?: unknown };
    if (record.kind === "Function" && record.effect === "linked") {
      found = true;
      return;
    }
    for (const [key, child] of Object.entries(record)) {
      if (key === "span" || key === "arrowSpan") continue;
      walk(child);
    }
  };
  walk(annotation);
  return found;
}

/**
 * §2.2.1's inlet test, asked of one signature: is there a `->?` in something a
 * caller *supplies*, for the signature's other arrows to link to?
 *
 * An inlet is an occurrence inside a **parameter type of any arrow on the
 * application spine** — the chain reached from the root by descending through
 * results — at any depth and polarity within that parameter type. A curried
 * signature is applied step by step and each step's arguments come from a
 * caller, so `() -> ((Int ->? Int) ->? Int)` has an inlet: the caller reaches it
 * at the second application (#408). Two occurrences are *not* inlets, and they
 * are the two the caller never supplies: a spine arrow's own colour (the
 * outer-only face) and one standing only in a terminal result (the
 * received-only face). A signature this returns `false` for cannot host a `->?`
 * at all: §4.4 refuses it.
 *
 * `parameters` and `result` are the declaration's parameter annotations and
 * return annotation for a header-form function, or a written function type's
 * own parameter subtrees and result.
 */
function signatureInlet(
  parameters: readonly (Resolved.TypeAnnotation | undefined)[],
  result: Resolved.TypeAnnotation | undefined,
): boolean {
  const supplied = (
    types: readonly (Resolved.TypeAnnotation | undefined)[],
  ): boolean =>
    types.some((type) => type !== undefined && annotationWritesLinkedArrow(type));
  if (supplied(parameters)) return true;
  // Descending through results only: each arrow reached this way is one the
  // caller applies, so its parameters are supplied too. The arrow's own effect
  // slot is skipped by construction — nothing here reads `node.effect`.
  for (
    let node = result;
    node !== undefined && node.kind === "Function";
    node = node.result
  ) {
    if (supplied(node.parameters)) return true;
  }
  return false;
}

/**
 * The two-pass schedule's **deferred class** (Functions §4.3): a syntactic
 * lambda literal — the arrow form, and Pattern Matching §6.7's scrutinee-less
 * `match`, which the parser desugars *to* one — annotated parameters or not,
 * **read through grouping parentheses**, so `(x => e)` defers as `x => e` does.
 * Nothing else defers: a name bound to a lambda, a call producing one, and an
 * ascribed lambda — whose face the ascription itself supplies — are all first
 * pass. One class serves both positions: argument, and callee (the pipe seat).
 */
function defersAsLambda(expression: Resolved.Expr): boolean {
  return expression.kind === "Lambda" ||
    (expression.kind === "Group" && defersAsLambda(expression.expression));
}

/**
 * Whether an expectation given to this expression could **land** — Functions
 * §4.3's two landing sites, a lambda literal and an arithmetic operation
 * (Numeric Literals §5.1's expected-type lift) — reached through §4.3's
 * forwarding set: grouping parentheses, a block's final expression, both `if`
 * branches, a `try`'s body block, and every `match`/`try` arm body, catch arms
 * included. **No other form forwards**, so a tuple component or a call's own
 * result stops it here. An operand does not forward either, but the operation
 * *above* it is a landing site, and the lift reaches the operands from there.
 *
 * This is not a typing rule and adds none: propagation is inert away from the
 * two sites, so a seat whose expectation cannot possibly land does not need to
 * compute one — and a seat that elaborates its annotation only when the answer
 * is `true` keeps every other program's elaboration order to the byte.
 */
function expectationLands(expression: Resolved.Expr): boolean {
  switch (expression.kind) {
    case "Lambda":
      return true;
    case "Binary":
      return liftsAtOperator(expression.operator);
    case "Unary":
      return expression.operator !== "Not";
    case "Group":
      return expectationLands(expression.expression);
    case "Block": {
      const final = expression.items.at(-1);
      return final?.kind === "ExprItem" && expectationLands(final.expression);
    }
    case "If":
      return expectationLands(expression.consequence) ||
        expectationLands(expression.alternative);
    case "Try":
      return expectationLands(expression.body) ||
        expression.arms.some((arm) => expectationLands(arm.body));
    case "Match":
      return expression.arms.some((arm) => expectationLands(arm.body)) ||
        (expression.catchArms ?? []).some((arm) => expectationLands(arm.body));
    default:
      return false;
  }
}

/**
 * The constraint an arithmetic operator elaborates to, or `undefined` for an
 * operator outside the lift's reach. Numeric Literals §5.1 names exactly four:
 * `Num`, `Signed`, `Frac`, `Pow`. `Concat`, the logical four, and `Range` carry
 * no algebra a written face could name, so no expectation lifts at them.
 */
function liftConstraint(
  operator: Resolved.BinaryOperator,
): Typed.ConstraintName | undefined {
  switch (operator) {
    case "Add":
    case "Multiply":
      return "Num";
    case "Subtract":
      return "Signed";
    case "Divide":
      return "Frac";
    case "Power":
      return "Pow";
    default:
      return undefined;
  }
}

function liftsAtOperator(operator: Resolved.BinaryOperator): boolean {
  return liftConstraint(operator) !== undefined;
}

/**
 * One call's argument checking, split so the **first pass** of it can run
 * before the deferred lambda literals are elaborated (Functions §4.3's argument
 * seat, #513/#517).
 */
interface ArgumentPass {
  /**
   * Checks the first pass's arguments — every index outside the deferred
   * lambda class — before the second pass elaborates.
   */
  readonly establishFirstPass: (deferredLambdas: ReadonlySet<number>) => void;
  /**
   * The dot-call half of `establishFirstPass` (Method Syntax §2.2): resolves
   * the member's instantiation from the first pass, and nothing else. A dot
   * call's authority is the whole-signature unification that follows, not this
   * pass, so an argument whose type §5.1 could **convert** — a `Nat` or an
   * `Int`, the only two sources — is left entirely to that check, which reads
   * the inferred type rather than the conversion. Every other argument is
   * checked exactly, which is what resolves the instantiation. Returns the
   * indices whose check *reported*, which the caller gives an `Error` so the
   * whole-signature unification absorbs them rather than repeating the report.
   */
  readonly resolveInstantiation: (
    deferredLambdas: ReadonlySet<number>,
  ) => ReadonlySet<number>;
  /** The rest of the sweep, then the two deferred classes. */
  readonly finish: () => void;
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

/** The borrowed view of a native JS `Map` (FFI Part 10 §1). */
interface JsMapMono {
  readonly kind: "JsMap";
  readonly key: Mono;
  readonly value: Mono;
}

/** The borrowed view of a native JS `Set` (FFI Part 10 §1). */
interface JsSetMono {
  readonly kind: "JsSet";
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

/**
 * The namespace alias an occurrence was written through (FFI Part 7 §2.4 rung
 * 3), carried on the three nominal monos so it survives into `Typed.Type`.
 *
 * It rides the node and nothing here reads it: instantiation and substitution
 * rebuild a nominal's *arguments* and spread the rest, so a derived declaration
 * — a specialization, a constructor arrow, an export wrapper — inherits the
 * qualifiers of the scheme it came from, which is what §2.4 requires of it.
 */
type Qualifier = Resolved.TypeQualifier;

interface UnionMono {
  readonly kind: "Union";
  readonly union: Resolved.UnionId;
  readonly name: string;
  readonly arguments: readonly Mono[];
  readonly qualifier?: Qualifier;
}

interface NominalRecordMono {
  readonly kind: "NominalRecord";
  readonly record: Resolved.RecordId;
  readonly name: string;
  readonly arguments: readonly Mono[];
  readonly qualifier?: Qualifier;
}

interface ExternMono {
  readonly kind: "ExternType";
  readonly externType: Resolved.ExternTypeId;
  readonly name: string;
  readonly qualifier?: Qualifier;
}

interface ErrorMono {
  readonly kind: "Error";
}

interface Requirement {
  readonly name: Typed.ConstraintName;
  /**
   * The identity of the constraint declaration this requirement demands
   * (`spec/constraints.md` §5.1.1) — what instance selection keys on.
   *
   * Distinct from `name` for exactly one reason, and it is the reason the field
   * exists: a requirement copied out of an *imported* scheme names a constraint
   * this module cannot spell, so re-deriving the identity from the name here
   * would mint one this module owns and find no instance. The defining module's
   * identity rides along instead (`#importScheme`).
   */
  readonly identity: string;
  readonly type: Mono;
  readonly span: Source.Span;
  /**
   * What demanded this requirement, where the failure report needs to know.
   *
   * `"iteration"` is a `for p in e` head and nothing else (Collections Part 5
   * §3.1 step 3). It is separated from the `"operation"` it would otherwise be
   * because §3.3's two-legal-homes message is a *loop-side* diagnostic: it tells
   * the user where to put an `Iterable` instance and what to do instead, which
   * is the right thing to say about a loop head and the wrong thing to say
   * about, for instance, a failing `toSeq(x)` call — that keeps the generic
   * requirement failure. Everywhere else in this file the two origins behave
   * identically, and deliberately so: nothing about *how* the constraint is
   * discharged changes.
   */
  readonly origin: "annotation" | "literal" | "operation" | "interpolation" | "iteration";
  /**
   * The `fun` member whose body raised this requirement, where one did (#700).
   *
   * Read by one report: a variable declared on a **block head** is shared by
   * every member that writes it, so §4.2's contract refusal has to say which
   * member's body exceeded the head's list — the head itself is innocent, and
   * "the body" names nothing in a block of several. Absent outside a member's
   * body, where the report falls back to the unqualified phrasing.
   */
  readonly demandedBy?: string;
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
  reported: boolean;
  dictionary?: string;
  structural?: boolean;
  dictionaryArguments?: readonly Requirement[];
  /**
   * The requirement raised for each direct component of a structurally
   * satisfied type, kept rather than discarded (#278). Emission renders this
   * selection instead of re-deriving the component structurally, which is what
   * let a hand-written component instance be ignored.
   */
  components?: readonly RequirementComponent[];
}

/** One direct component of a structural type, or of a derivation subject. */
interface RequirementComponent {
  readonly key: string;
  readonly requirement: Requirement;
}

interface Scheme {
  readonly variables: readonly Variable[];
  readonly type: Mono;
  /** Set on a constraint member's scheme: the constraint it belongs to. */
  readonly constraint?: string;
  /** That constraint's identity (§5.1.1), so the scheme can cross a boundary. */
  readonly constraintIdentity?: string;
  /** That constraint's subject, held rather than positionally implied. */
  readonly constraintSubject?: Variable;
  readonly impliedTypes?: ReadonlyMap<string, Variable>;
}

const ERROR: ErrorMono = { kind: "Error" };

/**
 * One head shape a matrix column's domain admits — one entry of Pattern
 * Matching §7's signature.
 *
 * `slots` are the types the head's sub-patterns are checked against, and they
 * are **instantiated**: the `Some` head of an `Option(Bool)` column carries
 * `Bool`, not the declaration's `a`. That is the whole of #594's second half —
 * a slot that arrives shapeless can decompose nothing, so every judgment built
 * on it stops one level too early.
 *
 * `print` is §7.3's renderer for this head, given its slots' own witnesses.
 */
interface CoverageHead {
  /** Grouping identity: two heads are the same head exactly when these match. */
  readonly key: string;
  readonly slots: readonly Mono[];
  readonly print: (slots: readonly string[]) => string;
  /**
   * Set where `print` had to fall back to §7.3's third tier — a bare name this
   * module cannot spell — so a report that lists the witness can state the
   * route. Absent for every head that printed a spelling the reader can paste,
   * which is what keeps the clause off the names a shallower tier spelled.
   */
  readonly route?: RouteNeed;
}

/**
 * One required constraint as a diagnostic may spell it — Constraints §5.1.1's
 * advised-spelling law, whose tiers `#constraintSpellings` walks.
 *
 * `sealed` is the fourth tier and carries no text on purpose: there is no
 * spelling and no route, so the report that holds one of these offers no
 * rewrite at all and names the gate instead.
 */
type ConstraintSpelling =
  | { readonly kind: "spelled"; readonly text: string }
  | {
    readonly kind: "routed";
    readonly text: string;
    /** The declaration's own name — what the route clause lists and imports. */
    readonly name: string;
    readonly path: string;
    readonly alias: string;
  }
  | {
    readonly kind: "sealed";
    readonly name: string;
    readonly identity: string;
    /**
     * Whether the declaration itself says it is not exported. False for the
     * other way into this tier — a declaration with no importable path — which
     * establishes nothing about exporting, so no report may claim it.
     */
    readonly unexported: boolean;
  };

/**
 * The text a spelling contributes to an advised binder list. A sealed one
 * contributes its bare name, which no caller ever prints: every one of them
 * checks for the fourth tier and reports the gate before it builds a list.
 */
function spellingText(spelling: ConstraintSpelling): string {
  return spelling.kind === "sealed" ? spelling.name : spelling.text;
}

/** One constructor a witness named without a pastable spelling (§7.3 tier 3). */
interface RouteNeed {
  /** The constructor's declared name — the bare spelling the witness printed. */
  readonly name: string;
  /** The path of the module its type was **declared** in, from that declaration. */
  readonly path: string;
  /** Whether that module is a prelude one, which has no importable path. */
  readonly prelude: boolean;
}

/**
 * One rendered witness: its columns, and the routes §7.3 owes if a report
 * lists it. The routes ride with the witness rather than with the report,
 * because the cap decides which witnesses a message names and only those
 * route — "the '…and N more' tail names no constructors and so routes none".
 */
interface CoverageWitness {
  readonly columns: readonly string[];
  readonly routes: readonly RouteNeed[];
}

/** A pattern split against its column: the heads it tests, and its sub-patterns. */
interface CoverageMatch {
  /**
   * Every head this pattern tests. One for all but the vector column, where a
   * single pattern names a whole family of lengths at once (Collections Part 3
   * §3.3: "a pattern with k fixed slots and a rest covers all lengths ≥ k").
   */
  readonly heads: readonly CoverageHead[];
  /**
   * The sub-patterns this pattern presents at one of `heads` — one per that
   * head's slots, widened to `_` where the pattern said nothing (§7.1). It is a
   * function of the head because the vector's rest form says different things
   * at different lengths: `[...init, x]` puts `x` at the last slot, wherever
   * the last slot happens to be.
   */
  readonly subPatterns: (head: CoverageHead) => readonly Resolved.Pattern[];
}

/** One column of Pattern Matching §7's matrix: what it admits, and how patterns split. */
interface CoverageColumn {
  /**
   * The domain's complete signature, or `undefined` where it has none: the
   * infinite domains (`Int`, `String`, `Float`) and the open `Exn` sum. A
   * column with no signature is covered by a wildcard and by nothing else,
   * which is §7.1's "a catch-all is required" said in the matrix's own terms.
   */
  readonly signature?: readonly CoverageHead[];
  /** `undefined` for a pattern that matches every value the column can hold. */
  readonly split: (pattern: Resolved.Pattern) => CoverageMatch | undefined;
}

/** What one family of unreachable-arm reports says; §7.2 in two seats. */
interface ReachabilityReports {
  /** An arm behind one that already covers the whole domain. */
  readonly everything: string;
  /** An arm whose head constructor is already covered in full above. */
  readonly constructor: (name: string) => string;
  /** A duplicate literal. */
  readonly literal: string;
  /** Covered by the arms above jointly, with no single arm to name. */
  readonly covered: string;
  /** Where the whole-arm report points. */
  readonly armSpan: (arm: Resolved.MatchArm) => Source.Span;
}

const MATCH_ARM_REPORTS: ReachabilityReports = {
  everything: "this match arm is unreachable; an earlier pattern matches everything",
  constructor: (name) => `this case is unreachable; \`${name}\` is already handled above`,
  literal: "this literal case is unreachable; it is already handled above",
  covered: "this case is unreachable; the patterns above already cover it",
  armSpan: (arm) => arm.pattern.span,
};

const CATCH_ARM_REPORTS: ReachabilityReports = {
  everything: "this catch arm is unreachable because an earlier arm catches everything",
  constructor: (name) => `exception \`${name}\` is already caught above`,
  literal: "this literal case is unreachable; it is already handled above",
  covered: "this catch arm is unreachable; the arms above already cover it",
  armSpan: (arm) => arm.span,
};

/**
 * How many witnesses the matrix will produce before it stops looking.
 *
 * §7.3 asks for three and a count, so the cap only has to be far enough above
 * three that the count is the real one for anything a person wrote. It is a
 * budget rather than a nicety: the complete-signature branch of algorithm I
 * fans out across a product of domains, and the early return is what keeps a
 * wide non-exhaustive tuple from enumerating it.
 */
const COVERAGE_WITNESS_LIMIT = 100;

/** How many witnesses a missing-cases report names before it counts the rest. */
const COVERAGE_WITNESSES_SHOWN = 3;

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

/**
 * The constraints every structural product satisfies componentwise (Constraints
 * §4.5), **as identities**. Held in `constraints.ts` since the specialization
 * planner reads the same inventory as `Unit`'s candidate rows (#679); see
 * `STRUCTURAL_CONSTRAINTS`.
 *
 * The planner asks in names because it works from a fixed table of prelude rows
 * and never sees a written spelling. `#validate` does see one, so it asks here
 * — a requirement raised under `import { Show as S }` carries the name `S` and
 * the identity `hex:Show`, and a name-keyed membership test answered "not
 * structural" and refused `show((1, 2))` (#727).
 */
const STRUCTURAL_IDENTITIES: ReadonlySet<string> = new Set(
  STRUCTURAL_CONSTRAINTS.map(preRegisteredConstraintIdentity),
);

/**
 * The four constraints a `derives` clause may name (Constraints §4.5), **as
 * identities** — the channel Modules §7.6's derivation-fixit bullet pins in so
 * many words (#644): "read by identity, never spelling".
 *
 * Spelling would be answerable by an importer's alias, which is the failure mode
 * §5.1.1's identity rule exists to close; all four are pre-registered and
 * non-redeclarable, so no rival declaration can occupy the name and the set is
 * exactly these four `hex:` rows forever.
 *
 * This set is the key at the `derives` seat **as well** (#727). The comment here
 * used to reserve that seat for a name-keyed test, on the premise that "the
 * constraint was just written, and §5.1.1's ban makes the spelling decisive".
 * The premise is measured false: §5.1.1's ban bars a rival *declaration*, not a
 * second *spelling*, and the prelude's modules are ordinary modules at the source
 * common root, reachable by **two** import channels —
 * `import { Hash as H } from "./Hash.hex"` and `import module M from
 * "./Hash.hex"`, binding `H` and `M.Hash`. Each is a working spelling of
 * `hex:Hash` with no redeclaration anywhere, and `derives (Eq, H)` was refused
 * as underivable while the identical program spelled `Hash` compiled. (The
 * `derives` seat itself takes only the bare form by grammar, so the alias
 * reaches it and the qualifier does not; `honor M.Hash<P> = derive` is where the
 * second channel arrives at derivation.) One declaration, one answer: every gate
 * over this inventory reads the identity, which is what makes it right for a
 * channel nobody has thought of yet, and only the *report* reads the word the
 * source wrote.
 */
const DERIVABLE_IDENTITIES: ReadonlySet<string> = new Set(
  ["Eq", "Ord", "Show", "Hash"].map(preRegisteredConstraintIdentity),
);

/**
 * The four pre-registered identities the gates below name **one at a time**,
 * rather than as a membership test. Bound once here so no seat re-mints one from
 * a word it happens to be holding, which is the shape the whole of #727 was.
 */
const HASH_IDENTITY: string = preRegisteredConstraintIdentity("Hash");
const EQ_IDENTITY: string = preRegisteredConstraintIdentity("Eq");
const SHOW_IDENTITY: string = preRegisteredConstraintIdentity("Show");
const CONCAT_IDENTITY: string = preRegisteredConstraintIdentity("Concat");

/**
 * The three constraints a hashed container answers from its contents
 * (Collections Part 2 §2.5), as identities. `Ord` is absent because a `Set` and
 * a `Map` are unordered, so there is no componentwise comparison to walk.
 */
const HASHED_CONTAINER_IDENTITIES: ReadonlySet<string> = new Set(
  ["Eq", "Show", "Hash"].map(preRegisteredConstraintIdentity),
);

/**
 * The head every user-facing `Hash` diagnostic opens with (#647, James's point
 * 4): Constraints §4.5's derivable-only law stated **positively**, telling the
 * reader what to write rather than what not to.
 *
 * One constant and not two spellings, because the two seats that print it — the
 * member-block refusal (Collections Part 2 §9) and Modules §7.6's replacement
 * sentence (#644) — are one voice by ruling, and a family that drifts is exactly
 * what the ruling was about. The spec's *prose* keeps "hand-written" as the term
 * of art for member-block provenance; it is no longer a phrase any message says.
 */
const HASH_MUST_BE_DERIVED = "`Hash` instances must be derived";

function primitive(name: Typed.PrimitiveName): Constructor {
  return { kind: "Constructor", name };
}

/**
 * The primitives whose home module is a **fixed prelude companion** (Constraints
 * §5.3, #344 — `Int` → `Int.hex` and its four siblings).
 *
 * Read off `PRIMITIVE_COMPANION_BASENAMES` rather than re-listed, so the orphan
 * rule's home for a primitive and the prelude's injection table cannot drift
 * apart. `Unit` and `Exn` are absent from both, and §5.3 says why for `Unit`: it
 * is the empty tuple, covered by the structural instances, with no home and none
 * needed.
 */
const PRIMITIVE_COMPANION_HOMES: ReadonlySet<string> = new Set(
  PRIMITIVE_COMPANION_BASENAMES.values(),
);

/**
 * One of the two legal homes Modules §7.6's missing-instance clause names.
 *
 * `path` is present exactly when the home is **offerable** — a module the reader
 * could write the honor in. A prelude or compiler-supplied home carries none,
 * and `statedHome` is the phrase that names it as fact instead. The asymmetry is
 * the spec's, not a convenience: "a prelude- or compiler-supplied home is named
 * as fact, never as repair".
 */
interface LegalHome {
  /** The declaration's own name — the subject constructor, or the constraint. */
  readonly name: string;
  readonly path?: string;
  readonly statedHome: string;
}

/**
 * The fixed public name of the stage-1 exception guard a module exporting an
 * exception publishes (`spec/exceptions.md` §7.6, FFI Part 7 §6 — #478). The
 * checker knows it because it owns the one collision rule around it (Part 7
 * §11); emission spells it independently, as it spells every face it writes.
 */
const IS_HEX_ERROR = "isHexError";

/** Whether any binder of a destructuring `let` claims the guard's name. */
function patternBindsGuardName(pattern: Resolved.Pattern): boolean {
  switch (pattern.kind) {
    case "Binding":
      return pattern.binding.name === IS_HEX_ERROR;
    case "As":
      return pattern.binding.name === IS_HEX_ERROR ||
        patternBindsGuardName(pattern.pattern);
    case "Vector":
      return pattern.elements.some(patternBindsGuardName) ||
        (pattern.rest?.pattern !== undefined &&
          patternBindsGuardName(pattern.rest.pattern));
    case "Tuple":
      return pattern.elements.some(patternBindsGuardName);
    case "Record":
      return pattern.fields.some((field) => patternBindsGuardName(field.pattern));
    case "Or":
      return pattern.alternatives.some(patternBindsGuardName);
    case "Constructor":
      return pattern.arguments.some(patternBindsGuardName);
    default:
      return false;
  }
}

/**
 * The two nominal identity spaces are separate counters, so a record and a union
 * can share a number. These two functions are the only place either becomes a
 * companion key, which is what keeps `record:3` and `union:3` apart.
 */
function recordCompanionKey(record: Resolved.RecordId): string {
  return `record:${Number(record)}`;
}

function unionCompanionKey(union: Resolved.UnionId): string {
  return `union:${Number(union)}`;
}

/**
 * The compiler-built-in heads that have a companion module rather than a
 * declaration: `Vector`, `Map`, `Set`. §4.1 gives them "the fixed prelude
 * companion module of the same name", and Collections Part 3 §7 says which
 * module that is at any moment — the one addressable under the name here, which
 * is how `stdlib/Vector.hex` occludes the compiler's own core inventory today.
 *
 * They are keyed by name because there is no declaration to key on: no `.hex`
 * file declares `Vector`, so `bindingSpan.fileId` cannot answer "is this
 * operation the companion's?" the way it does for a nominal type. The module
 * alias answers instead. When nothing supplies one — the shipped-today
 * configuration, where `stdlib/Vector.hex` is in `stdlib/` but in no project's
 * prelude — the set is empty and every dot call on such a receiver reports,
 * which is #217's fix.
 */
const BUILTIN_COMPANIONS: ReadonlyMap<string, string> = new Map([
  ["Vector", "builtin:Vector"],
  ["Map", "builtin:Map"],
  ["Set", "builtin:Set"],
]);

/**
 * The fixed prelude companion of each primitive that exists as source (#344).
 *
 * Method Syntax §4.1 always gave every primitive a companion; until the arc, no
 * such module existed, so a primitive's dot surface was its honored members
 * alone and the export clause of §4.2 had nothing to draw on. `BigInt.hex` is
 * the first that does — `4n.lcm(6n)` and `5n.toInt()` are its ordinary exports,
 * reached exactly as `Vector`'s are through the alias its prelude seat binds.
 * `Int.hex` and `Nat.hex` followed, bringing `9.checkedMul(9)`-shaped surfaces
 * of their own (`Nat.hex`'s one export takes an `Int` first, so it is reached
 * qualified — `Nat.fromInt(-1)` — not as a dot call on a `Nat`). `Float.hex`
 * and `String.hex` closed the migration: `Float`'s companion surface is `mod`
 * and `rem` (Division & Remainder §5), reached on a receiver as
 * `theta.mod(tau)`, and `String.hex` exports nothing at all — its entry earns
 * its keep entirely by being the home an honored member is read from.
 */
const PRIMITIVE_COMPANIONS: ReadonlyMap<string, string> = new Map([
  ["BigInt", "primitive:BigInt"],
  ["Int", "primitive:Int"],
  ["Nat", "primitive:Nat"],
  ["Float", "primitive:Float"],
  ["String", "primitive:String"],
]);

/**
 * §4.2's `T`-headed test, run on a declaration: the outermost type constructor of
 * a first parameter's annotation, when that constructor is a nominal one.
 *
 * A built-in collection head answers with its named companion instead
 * (`BUILTIN_COMPANIONS`). Anything else is `undefined` and therefore dot-callable
 * on nothing — a bare type variable (`identity(x: a)`), a primitive, a function,
 * a structural record. Aliases never reach here unexpanded: the resolver expands
 * them in place (§4.3), so `type Name = String` contributes a `String` head and
 * no companion of its own.
 */
function companionKeyOfAnnotation(
  annotation: Resolved.TypeAnnotation | undefined,
): string | undefined {
  if (annotation === undefined) return undefined;
  if (annotation.kind === "RecordDeclaration") return recordCompanionKey(annotation.record);
  if (annotation.kind === "Union") return unionCompanionKey(annotation.union);
  if (annotation.kind === "Primitive") return PRIMITIVE_COMPANIONS.get(annotation.name);
  return BUILTIN_COMPANIONS.get(annotation.kind);
}

/**
 * §4.2's companion operation set for the nominals **this** module declares,
 * read off its own exported declarations and nothing else (#585).
 *
 * This is `CompanionOf` said in code (Method Syntax §4.1, Modules §7.2): a
 * nominal's operations are its *home module's* exported subject-first
 * declarations, decided once where the type is declared. Read from anywhere
 * else the answer would be a function of what the reader happened to import,
 * and §4.2 forbids exactly that — "no import adds or removes a dot-callable
 * operation", "the set is import-insensitive… by construction". The construction
 * is this function: nothing here can see an importer.
 *
 * Exported so `compileProject` can accumulate the program's sets
 * dependency-first, the way it already accumulates `programNominals`. A type
 * nameable at a call site had its home module compiled first — imports are
 * acyclic and a type reference can only follow one — so the accumulated table is
 * complete for every receiver a module can write, including the transitive ones:
 * a nominal reached through a re-export or an imported function's result, whose
 * home module this call site never named in any form.
 *
 * **Nominal keys only.** A built-in head (`Vector`, `Map`, `Set`) and a
 * primitive have no declaration to be at home in, so `home` below holds no key
 * for them and their operations stay with the alias channel that has always
 * answered for them (`BUILTIN_COMPANIONS`, `PRIMITIVE_COMPANIONS` — see
 * `#indexCompanionOperations`). That channel is already import-insensitive in
 * the way that matters: the alias *is* the companion.
 *
 * The subject comes from the written annotation rather than from a scheme, for
 * the order-independence `#indexCompanionOperations` explains: §4.2's `T`-headed
 * test "is a syntactic test, not a unification question".
 */
export function homeCompanionOperations(
  module: Resolved.Module,
): ReadonlyMap<string, ReadonlyMap<string, Resolved.Symbol>> {
  const symbols = new Map(module.symbols.map((symbol) => [symbol.id, symbol]));
  // Only the nominals declared *here*. `module.records` carries imported copies
  // too, and admitting an operation onto one of those is precisely the orphan
  // the home-module filter exists to refuse (§1's "one companion, no search").
  const home = new Set<string>();
  for (const record of module.records) {
    if (Number(record.span.fileId) === Number(module.fileId)) {
      home.add(recordCompanionKey(record.id));
    }
  }
  for (const union of module.unions) {
    if (Number(union.span.fileId) === Number(module.fileId)) {
      home.add(unionCompanionKey(union.id));
    }
  }
  const found = new Map<string, Map<string, Resolved.Symbol>>();
  const admit = (
    binding: Resolved.Binding,
    annotation: Resolved.TypeAnnotation | undefined,
  ): void => {
    const subject = companionKeyOfAnnotation(annotation);
    if (subject === undefined || !home.has(subject)) return;
    const symbol = symbols.get(binding.symbol);
    // Symbol kind, not declaration shape — the same test `admit` runs in the
    // checker, and for the same reason: an intrinsic `extern fun` binds as kind
    // `fun` so that it lands here (#134), while an ordinary foreign `extern`
    // binds as kind `extern` and stays out (#266).
    if (symbol === undefined || (symbol.kind !== "fun" && symbol.kind !== "let")) return;
    let operations = found.get(subject);
    if (operations === undefined) {
      operations = new Map();
      found.set(subject, operations);
    }
    operations.set(symbol.name, symbol);
  };
  for (const item of module.items) {
    if (item.kind === "ExternBlock") {
      for (const declaration of item.declarations) {
        if (declaration.kind !== "ExternFun" || !declaration.exported) continue;
        admit(declaration.binding, declaration.parameters[0]?.annotation);
      }
      continue;
    }
    if (item.kind !== "Fun" && item.kind !== "Let") continue;
    if (!item.exported) continue;
    admit(item.binding, firstParameterAnnotation(item));
  }
  return found;
}

/**
 * One companion operation as the program table carries it: the home module's
 * symbol, and the scheme that module published for it.
 *
 * The scheme travels because the symbol table does not reach far enough. A
 * consumer holds the schemes of what its own imports carried, and the whole
 * point of #585's transitive case is an operation no import here carried — so
 * `importedSchemes` can be silent about exactly the entries this table exists to
 * add.
 */
export interface ProgramOperation {
  readonly symbol: Resolved.Symbol;
  readonly scheme: Typed.Scheme;
  /**
   * The home module's project-normalized path, and the internal export
   * spellings it published — what §8.2's added import is written from when a
   * call site reaches this operation with no import of its own
   * (`Typed.CompanionImport`).
   */
  readonly path: string;
  readonly internalNames: Resolved.InternalNameInputs;
}

/** Every nominal's companion operation set, by companion key then by name. */
export type ProgramOperations = ReadonlyMap<string, ReadonlyMap<string, ProgramOperation>>;

/**
 * The first parameter's annotation of a module-level function declaration.
 *
 * Two spellings reach here. A header form (`fun map(s: Seq(a), …)`, and the
 * `let` header the stdlib uses just as often — `export let length(source:
 * Seq(a)): Int`) carries its parameters on the lambda the parser built. A `let`
 * bound to a written function *type* carries them on the annotation instead.
 * Both are functions with a first parameter, so §4.2 asks the same question of
 * both; a `let` whose value is an unannotated lambda answers with nothing, which
 * is the same "no declared head, no candidacy" the syntactic test gives a bare
 * type variable.
 */
function firstParameterAnnotation(
  item: Resolved.FunItem | Resolved.LetItem,
): Resolved.TypeAnnotation | undefined {
  if (item.kind === "Let" && item.annotation !== undefined) {
    return item.annotation.kind === "Function" ? item.annotation.parameters[0] : undefined;
  }
  return item.value.kind === "Lambda" ? item.value.parameters[0]?.annotation : undefined;
}

/**
 * One constraint member a dot call could mean (Method Syntax §4.2).
 *
 * `subjectFirst` is the section's syntactic test, decided once per declaration:
 * the first parameter's written type is the constraint's subject variable
 * itself. `show(value: a)` and `compare(left: a, right: a)` qualify; `fromNat(
 * value: Nat): a` does not — the subject appears only in the return, so
 * `42.fromNat(…)` is not a spelling and never will be.
 */
interface MemberCandidate {
  /** The constraint's declared name — also the qualified home a fixit spells. */
  readonly constraint: string;
  readonly identity: string;
  readonly member: string;
  readonly symbol: Resolved.SymbolId;
  readonly subjectFirst: boolean;
}

/**
 * One dot call whose receiver was not head-known when elaboration reached it
 * (Method Syntax §2.2, §3.1).
 *
 * The arguments are inferred once, at the dot, and carried: evaluation order is
 * receiver-then-arguments (§2.3), and deferring their *inference* as well would
 * make the meaning of a program depend on when a goal happened to settle.
 */
interface DotCallGoal {
  readonly expression: Resolved.CallExpr;
  readonly callee: Resolved.AccessExpr;
  readonly receiver: Mono;
  readonly argumentTypes: readonly Mono[];
  /** Pinned to the receiver's region, per §3.1's pinning rule. */
  readonly result: Mono;
  readonly level: number;
}

/** One member of a `fun` block's strongly-connected component (Functions §7.4). */
interface KnotMember {
  readonly symbol: Resolved.SymbolId;
  readonly name: string;
  /**
   * Modules §4.1.1 requires a complete signature on an export, so "leave the
   * heads off" is not a spelling an exported member can take — which is what
   * §7.4's refusal has to know before it offers one. How many of the colliding
   * members export decides which spellings are legal; `knotHeadCollisionMessage`
   * has the three arms.
   */
  readonly exported: boolean;
}

/**
 * Where a declared type variable was written — the two sites §10's rigid-vs-rigid
 * message qualifies a side by (#700).
 *
 * A member's own annotations name the member; a `fun` block head binds no name,
 * so it is located by its span instead. The distinction is not cosmetic: the
 * head is the language's one **sharing** route, so a side declared there has a
 * different repair from a side a member wrote for itself.
 */
type HeadOwner =
  | {
      readonly kind: "member";
      readonly symbol: Resolved.SymbolId;
      readonly name: string;
    }
  | {
      readonly kind: "block";
      /** Every member the head scopes over, for the knot-membership test. */
      readonly members: readonly Resolved.SymbolId[];
      readonly span: Source.Span;
    };

/** One side of §10's rigid-vs-rigid refusal, resolved against the live knot. */
type HeadSite =
  | { readonly kind: "member"; readonly member: KnotMember }
  | { readonly kind: "block"; readonly span: Source.Span };

/**
 * One monomorphic knot under check: the component's members, the member whose
 * body inference is currently inside it, and every reference that resolved to a
 * member from within it.
 *
 * `host` is the member the reference is *written in*, which is not the enclosing
 * `#declaringMember` — a reference may sit inside a nested lambda or a nested
 * `fun` block, and the dictionaries in scope there are still the host's.
 */
interface Knot {
  readonly members: readonly KnotMember[];
  host: Resolved.SymbolId | undefined;
  readonly references: {
    readonly host: Resolved.SymbolId;
    readonly target: Resolved.SymbolId;
  }[];
  /**
   * Whether §7.4's declared-heads refusal has fired on this component.
   *
   * The refusal is the knot's, so it reports once and errors every head the
   * component has — including the heads of members whose bodies are not checked
   * yet, which is why the flag outlives the collision that set it.
   */
  refused: boolean;
}

/** The module a receiver head's companion is addressed under (§4.1's table). */
function companionHeadName(type: Mono): string | undefined {
  if (type.kind === "NominalRecord" || type.kind === "Union") return type.name;
  if (type.kind === "Vector" || type.kind === "Set" || type.kind === "Map") return type.kind;
  if (type.kind === "Constructor") return type.name;
  return undefined;
}

/**
 * The type variables a parameterized instance head introduces, in head order
 * and without duplicates (#390).
 *
 * The head is the declaration of these binders: `honor Iterable<Bag(a)>` binds
 * `a` exactly as `honor<a>` does, and the `<...>` prefix only adds constraints
 * to some of them. Non-nominal subjects yield nothing — a head that is not a
 * nominal constructor is refused by `#checkInstanceHead` on its own grounds,
 * and a non-variable argument is refused there too, so both channels that mint
 * from this list mint only what the head lawfully binds.
 */
function headBinderNames(subject: Resolved.TypeAnnotation): readonly string[] {
  if (subject.kind !== "Union" && subject.kind !== "RecordDeclaration") return [];
  return [
    ...new Set(
      subject.arguments.flatMap((argument) =>
        argument.kind === "TypeVariable" ? [argument.name] : []
      ),
    ),
  ];
}

/**
 * The module alias a `widens` head would qualify through, read off the spelling
 * an `honor` head wrote (Constraints §4.7: the path is module-alias
 * qualification, the only kind there is).
 *
 * A namespace-imported constraint is written `Alias.Name`, and the alias is the
 * half the head wants. A bare spelling is a prelude constraint, whose declaring
 * module is addressable under its own basename (Modules §6.4) — `Pow.hex`
 * declares `Pow` — so the one word serves as both.
 */
function moduleAlias(constraint: string): string {
  const dot = constraint.indexOf(".");
  return dot === -1 ? constraint : constraint.slice(0, dot);
}

function constraintMemberCandidates(
  declaration: Resolved.ConstraintItem,
): readonly MemberCandidate[] {
  return declaration.members.map((member) => {
    const first = member.parameters[0]?.annotation;
    return {
      constraint: declaration.name,
      identity: declaration.identity,
      member: member.binding.name,
      symbol: member.binding.symbol,
      subjectFirst: first?.kind === "TypeVariable" && first.name === declaration.subject,
    };
  });
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
  /* ---------------------------------------------------------------------
   * The effect dimension (`spec/effects.md`). Unconditional: every function
   * `Mono` this checker builds carries an effect slot, every call records its
   * mark obligation, and `#settleEffects` reports them once every body has
   * closed.
   * ------------------------------------------------------------------- */

  /**
   * The signature currently being elaborated, when it is **linked** — when at
   * least one `->?` stands in something a caller supplies (§2.2.1's inlet).
   * `undefined` means a written `->?` has nothing to denote, which since #405 is
   * §4.4's error: a signature with no inlet, a data declaration, an alias body,
   * or a type position outside every signature, each named by
   * `#linkedArrowPosition`.
   *
   * It stays in force through the body it heads, which is what makes §2.2.2's
   * local positions work: a binding annotation or an ascription with no inlet of
   * its own reads this face rather than clearing it, so its `->?` is the
   * enclosing signature's one colour.
   */
  #signatureFace: SignatureFace | undefined;
  /**
   * Which kind of position is being elaborated, for §4.4's middle clause.
   *
   * `->?` is refused wherever there is no signature to link it to, and the
   * report names *why* this position has none — a `record` field and a `type`
   * alias are wrong for different reasons and the writer is owed the right one.
   * `"signature"` is the default and covers a real signature whose spine offers
   * no inlet (§2.2.1's outer-only and received-only faces, and any `->?` written
   * inside an inlet-less body). `"no-signature"` is the module level, where a
   * binding annotation, an `extern let`, or a `var` sits outside every signature
   * and so has none to borrow either (§2.2.2).
   */
  #linkedArrowPosition:
    | "signature"
    | "record"
    | "union"
    | "alias"
    | "no-signature" = "signature";
  /** Arrow spans §4.4 has already condemned, keyed `fileId:start`. */
  readonly #reportedLinkedArrows = new Set<string>();
  /**
   * An inlet a *binding annotation* supplies to the lambda that is its
   * right-hand side. `let f: (Tx ->? a) ->! a = (run) => …` writes the callback
   * arrow on the binding, not on the lambda's own parameters, so without this
   * the body would have no inlet to join and its `?` would be refused.
   * Read-and-cleared by the next lambda pushed.
   */
  #pendingInlet = false;
  readonly #effectFrames: EffectFrame[] = [];
  /**
   * The outer colour a *binding annotation* fixes for the lambda that is its
   * right-hand side, read syntactically so it is in hand before the body is
   * inferred. This is what lets `->!` mean what ruling 9 says: the outer arrow
   * is the impure constant from the start, so the body's own effects are
   * absorbed by a colour that is already constant and the callback's colour is
   * left free — the round-up applies to the function, not to what it forwards.
   */
  #pendingOwnEffect: Mono | undefined;
  /** Signature colours a face report has already condemned; see `#checkMarks`. */
  readonly #reportedFaces = new Set<Variable>();
  readonly #frameByLambda = new WeakMap<Resolved.LambdaExpr, EffectFrame>();
  /**
   * The frame a call was *written* in. Dot calls may be elaborated later, from
   * a goal settled at a generalisation boundary where the frame stack no longer
   * describes the source, so the frame is captured where the expression is
   * first reached and read back when the call's arrow is finally known.
   */
  readonly #callFrames = new WeakMap<Resolved.CallExpr, EffectFrame | undefined>();
  readonly #markObligations: MarkObligation[] = [];
  readonly #signatureFaces: SignatureFace[] = [];
  /** Written `->!` faces awaiting ruling 9's symmetric half. */
  readonly #constantFaces: {
    readonly lambda: Resolved.LambdaExpr;
    readonly arrowSpan: Source.Span;
  }[] = [];

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
    readonly symbol: Resolved.SymbolId;
    /** The declared name the call dispatched on, before any local re-spelling. */
    readonly name: string;
    /**
     * The evidence this call supplies. Both resolutions fill it: a
     * member-resolved dot call always did, and a companion-resolved one joined
     * at #370, when `stdlib/Map.hex`'s keyed trio became the first constrained
     * companion operation in the language. Unconstrained operations — which is
     * every other one — record an empty list.
     */
    readonly requirements: readonly Requirement[];
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
  /**
   * The span of the ascribed type currently being elaborated, or `undefined`
   * outside one. Read only by `#annotationType`'s type-variable arm, to mark the
   * variables an ascription *declares* (Ascription §3.1). A field rather than a
   * parameter because elaboration never re-enters expression inference, so there
   * is exactly one ascription in flight at a time.
   */
  #ascribedTypeSpan: Source.Span | undefined = undefined;
  readonly #unions = new Map<Resolved.UnionId, Resolved.Union>();
  readonly #constructorUnions = new Map<Resolved.SymbolId, Resolved.UnionId>();
  readonly #unionParameters = new Map<Resolved.UnionId, ReadonlyMap<string, Variable>>();
  /**
   * `#programNominals.unions` by identity, and by constructor symbol, built on
   * the first question asked of either (#605); see `#programUnion`. Undefined
   * until then, for the reason `#programRecordIndex` is.
   */
  #programUnionIndex?: ReadonlyMap<Resolved.UnionId, Resolved.Union>;
  #programConstructorIndex?: ReadonlyMap<Resolved.SymbolId, Resolved.UnionId>;
  /**
   * Every union `#materializeReachedUnion` registered, in the order it did.
   *
   * The typed module's union list is what the elaborator forwards and the
   * emitter's constructor table and tagging judgment are built from, so a union
   * the checker reached without importing has to leave by that door too, or the
   * accepted program is emitted as if its constructors were untagged strings.
   */
  readonly #reachedUnions = new Set<Resolved.UnionId>();
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
   * This module's own path, when the compilation had one
   * (`Resolved.Module.path`). Read by Collections Part 5 §3.3's diagnostic and
   * nothing else: a message that names another module's file has to state the
   * route from here, and "here" is not something `fileId` answers.
   */
  #modulePath: string | undefined;
  /**
   * Every union and record identity the *prelude* supplies, as sets.
   *
   * `module.preludeUnions`/`preludeRecords` are keyed by name, and a name is the
   * one thing a module may occlude (Modules §5.4); the question §3.3 asks —
   * "could the user open the file this declaration lives in?" — is about the
   * identity, so the identities are what is kept. Both are empty in a
   * prelude-free compilation, which is correct: nothing is prelude-supplied
   * there.
   */
  #preludeUnionIds: ReadonlySet<Resolved.UnionId> = new Set();
  #preludeRecordIds: ReadonlySet<Resolved.RecordId> = new Set();
  /**
   * What the **bare** spelling of a name denotes in this module — Pattern
   * Matching §7.3's tier 1 asks exactly this question, and it is the resolver's
   * to answer (Modules §5.4/§5.5: an import or a local declaration occludes a
   * prelude name, and nothing downstream re-derives the layering).
   *
   * Built from `Resolved.Module.scopes` in the order the resolver recorded them
   * — outermost first, so a later region's binding wins — which is the same
   * containment reading `ScopeRegion`'s own doc states. Only constructor
   * spellings are ever looked up here, and a constructor name is upper-case, so
   * the flattening across nested regions cannot answer for a binder that is not
   * module-level in the first place.
   */
  #bareNames: ReadonlyMap<string, Resolved.SymbolId> = new Map();
  /** The inverse: the bare spelling a symbol answers to here, if any. */
  #bareSpellings: ReadonlyMap<Resolved.SymbolId, string> = new Map();
  /**
   * The pastable **qualification** a symbol has here (§7.3 tier 2):
   * `Bool.True` through a prelude module's ambient name, `A.Off` through an
   * `import module` alias. Both spellings are legal in pattern position
   * (Modules §3.3).
   *
   * A module alias shadows an earlier one of the same name — the resolver lists
   * the module's own aliases before the prelude's, so first entry wins — which
   * is what leaves the shadowed-prelude corner with no qualification at all.
   */
  #aliasQualifications: ReadonlyMap<Resolved.SymbolId, string> = new Map();
  /** Every module-alias spelling in scope, for the derived-alias repair. */
  #aliasNames: ReadonlySet<string> = new Set();
  /**
   * Every pattern the checker's **own verdict** found ill-typed — Pattern
   * Matching §7.3's "a pattern that failed to type must not widen the witness's
   * vocabulary".
   *
   * Membership is decided at the one seat that can decide it: a unification of
   * the pattern's own shape against its expected type that reported. Nothing
   * else infers brokenness — not a neighbouring diagnostic, not a shape the
   * coverage column failed to recognize — because the obligation is stated
   * against the checker's verdict and a guess either side of it changes which
   * programs report.
   */
  readonly #brokenPatterns = new Set<Resolved.Pattern>();
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
   * The primitive this module is the fixed prelude companion of, when it is one
   * (`Resolved.Module.companionPrimitive`; Constraints §5.3, #344).
   *
   * A primitive has no declaration, so the orphan rule's "the module that
   * declares `T`" had nothing to point at for a primitive head, and `Hash`'s
   * derivable-only law had no `derives` clause to send a companion to. The
   * companion module is the home the ruling supplies, and this is the whole of
   * what the checker reads it for — two carve-outs, each scoped to *this*
   * primitive, and neither reachable from a user module, whose compilation never
   * sets the field.
   */
  #companionPrimitive: Resolved.PrimitiveName | undefined;
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
  /**
   * `#programNominals.records` by identity, built on the first question asked of
   * it (#587); see `#programRecord`. Undefined until then, because most modules
   * never reach a record they did not import and would pay for a table they
   * never read.
   */
  #programRecordIndex?: ReadonlyMap<Resolved.RecordId, Resolved.RecordDeclaration>;
  /**
   * Each nominal record's constructor symbol, to the record it constructs. A
   * set until #591; the identity is what the constructor **pattern** needs, to
   * ask the declaration for the row its one sub-pattern checks against and to
   * recognise the pattern as the record's sole constructor.
   */
  readonly #recordConstructors = new Map<Resolved.SymbolId, Resolved.RecordId>();
  readonly #aliasParameters = new WeakMap<Resolved.TypeAliasItem, ReadonlyMap<string, Variable>>();
  /** Each type alias's elaborated target, memoized — see `#aliasTarget`. */
  readonly #aliasTargets = new WeakMap<Resolved.TypeAliasItem, Mono>();
  readonly #exceptions = new Map<Resolved.SymbolId, Resolved.ExceptionItem>();
  /**
   * The dot-callable operations of each nominal type, by that type's identity
   * (Method Syntax §4.1/§4.2).
   *
   * `CompanionOf` is a function of the **receiver's head constructor**, so this
   * is keyed on the receiver's identity and not on the operation's name. What a
   * key answers is §4.2's set verbatim: the functions *exported by the type's
   * home module* whose *first parameter is `T`-headed*. Two independent filters,
   * both of them required — an exported subject-first `double(b: Box)` written
   * in a module that merely imports `Box` is not `Box`'s, and neither is a
   * private one written in `Box`'s own file (§4.2's "exported only, uniformly").
   * A head with no declaration to be the home of — `Vector`, `Map`, `Set` —
   * substitutes the module addressable under its own name; see
   * `BUILTIN_COMPANIONS`.
   *
   * This replaces a flat name table over every `fun`/`let` symbol in scope,
   * last-wins (#267). That table made dispatch **lexical**, which §1 forbids in
   * as many words: a module-level `map` won `s.map(f)` outright, and the program
   * silently called it instead of the companion's. Three other binder kinds
   * produced three other wrong answers, and a `Vector` receiver reached prelude
   * `Seq.length` for a type mismatch where a companion diagnostic belonged
   * (#217).
   *
   * Candidates are drawn from the symbols this module already has in hand — its
   * own declarations plus everything it imports, the prelude included — exactly
   * as the name table was. §4.2's import-insensitivity is therefore still only
   * as wide as the symbol table: an operation in a home module this file never
   * imports has no symbol here to bind and no local spelling to emit, which is a
   * plumbing question this fix deliberately does not open.
   */
  readonly #companionOperations = new Map<string, Map<string, Resolved.Symbol>>();

  /**
   * The honor-block members a `widens` declaration supplies, waiting for the end
   * of the module's items (Constraints §4.7) — see the deferral's own note where
   * they are filed.
   */
  #derivedMembers: { readonly key: string; readonly check: () => void }[] = [];

  /**
   * The (instance, member) pairs whose `widens` declaration failed §4.7's
   * signature check — keyed exactly as `#derivedMembers` keys its entries, so a
   * failed door derives nothing and reports once.
   */
  readonly #failedWidens = new Set<string>();
  readonly #operationSpellings = new Map<Resolved.SymbolId, string>();
  /**
   * The `fun` blocks whose bodies are currently being checked, innermost last.
   * A dot call inside one may not target any of their members (Method Syntax
   * §4.4): a call spelled through a dot is invisible to the reference graph the
   * resolver and `#inferFunGroup` both read, so allowing it would let dispatch
   * close a cycle neither can see.
   */
  readonly #funGroups: Set<Resolved.SymbolId>[] = [];
  /**
   * The monomorphic knots whose bodies are currently being checked, innermost
   * last: one frame per strongly-connected component, holding the members typed
   * at their not-yet-generalized monotype (Functions §7.4).
   *
   * Narrower than `#funGroups`, which bounds *visibility* over the whole
   * block. Only a component's own members are inside the knot, and only
   * they take the identity evidence suffix.
   */
  readonly #knots: Knot[] = [];
  /**
   * Every reference that resolved *inside* a knot, and the member it named.
   *
   * A knot member's scheme is a bare monotype while the component is being
   * checked, so instantiating it collects no requirements — and downstream an
   * empty evidence list is exactly what an unconstrained call looks like, which
   * is how a constrained recursive call came to be emitted with its dictionary
   * suffix dropped (#368). The constraints are not knowable at the reference:
   * they accumulate on the shared variables as the component's bodies are
   * inferred. So the reference is recorded here and its evidence read off the
   * member's finished scheme at materialization — `#knotEvidence`.
   */
  readonly #knotReferences = new WeakMap<Resolved.NameExpr, Resolved.SymbolId>();
  /**
   * The `fun` block member whose declared head is about to be elaborated, and
   * the member each declared type variable's head belongs to.
   *
   * Read by one diagnostic: §7.4's declared-heads refusal names the member each
   * rigid was declared on, and two members of one block habitually spell the
   * same variable name, so the name alone cannot tell them apart.
   */
  #declaringMember: { readonly symbol: Resolved.SymbolId; readonly name: string } | undefined;
  readonly #declaredHeadOwners = new Map<number, HeadOwner>();
  /**
   * The site an annotation-introduced type variable minted right now belongs to
   * — the `fun` member whose body is being checked, or `undefined` anywhere else
   * (#700).
   *
   * Distinct from `#declaringMember`, which is consumed by the member's own
   * lambda as it opens: this one stays set for the whole of the member's body,
   * because a variable a nested annotation is the first to write is still that
   * member's declaration (§4.1's scoped-to-the-declaration rule).
   */
  #annotationOwner: HeadOwner | undefined;
  /**
   * The same attribution read the other way: a member's own declared heads.
   *
   * The refusal is the *knot's*, not one pair's — §10 says "the refusal takes
   * the SCC hint", singular — so `#errorKnotHeads` has to reach every head in
   * the component, including the ones no collision named. Without the inverse,
   * at three headed members the third survives to be defaulted and reported as
   * demanding an `Int` the program never writes.
   */
  readonly #memberHeadVariables = new Map<Resolved.SymbolId, Variable[]>();
  readonly #constraintNames = new Set<string>(PRE_REGISTERED_CONSTRAINTS);
  /**
   * What a module alias offers a bare name that failed to be a constraint
   * (Modules §10's row, constraint half).
   *
   * The same-spelled export never lands here — §5.1 rule 2's companion fallback
   * resolved it, and this map is only read on the refusal path. What is left is
   * the alias whose module exports constraints under *other* spellings, where
   * the qualified route is the repair worth naming.
   */
  readonly #aliasConstraints = new Map<
    string,
    { readonly specifier: string; readonly exported: readonly string[] }
  >();
  /**
   * Every constraint name this module can spell, mapped to the identity of the
   * declaration it denotes (`spec/constraints.md` §5.1.1). Seeded with the
   * pre-registered inventory — one compiler-held declaration each — and
   * extended by this module's own declarations.
   *
   * Extended by imports (Modules §3.1/§3.3): this is the one place an imported
   * constraint's identity joins, and every name-taking call site below reads it
   * rather than re-deriving. A qualified `Geo.C` binder enters under that exact
   * spelling, the alias being part of the name the source wrote.
   *
   * Names are what source spells; identities are what the machinery keys on.
   * The map is the border between them, and it is deliberately *not* total over
   * requirements: one for a constraint this module cannot spell has no entry
   * here and carries its identity instead.
   */
  readonly #constraintIdentities = new Map<string, string>(
    PRE_REGISTERED_CONSTRAINTS.map(
      (name) => [name, preRegisteredConstraintIdentity(name)] as const,
    ),
  );
  readonly #constraintSubjects = new WeakMap<Resolved.ConstraintItem, Variable>();
  readonly #constraintImpliedTypes = new WeakMap<
    Resolved.ConstraintItem,
    ReadonlyMap<string, Variable>
  >();
  readonly #instances = new Map<string, Resolved.HonorItem>();
  /**
   * Which of `#instances`' entries are Collections Part 5 §4's provided rows.
   *
   * Read at exactly two places, and both are about the rows having no source:
   * `#validate` marks their discharge *structural* rather than handing emission
   * a dictionary name no module exports, and the orphan report asks whether the
   * slot a user tried to fill is one the prelude already holds (§7.3).
   */
  readonly #providedIterableRows = new Set<Resolved.HonorItem>();
  readonly #instanceIdentities = new Map<string, string>();
  /**
   * The same instances, keyed the other way round: subject key → the constraint
   * identities honored at it.
   *
   * §4.2's second clause asks "which constraints are honored at `T`", which the
   * forward table cannot answer without scanning it. Both tables are written by
   * `#admitInstance` from one `#subjectKey`, so the reverse view cannot drift
   * from the coherence key selection uses.
   */
  readonly #instancesBySubject = new Map<string, Set<string>>();
  /**
   * §3's deferred DotCall goals: the dot calls whose receiver was still an
   * unsolved variable when elaboration reached them.
   *
   * The goal is what lets the receiver's type arrive from *anywhere* in its
   * owner region — before the call or after it — and what puts the defaulting
   * step ahead of the row fallback (§3.3/§3.5). Nothing about a resolved goal
   * differs from a dot call that resolved at the dot; monotonicity is what
   * guarantees that (§3.2), and it is why deferral needs no re-checking of the
   * ones that never pended.
   */
  readonly #dotCallGoals: DotCallGoal[] = [];
  /**
   * Every type hole elaborated in this module, with the variable it became.
   *
   * Hover is the only reporting channel a hole has (closure doc §7), and a hole
   * is not a name, so the occurrence index — which is keyed on names — cannot
   * answer about one. The spans are recorded here as they are elaborated and
   * read back at materialization, once the variable has been solved.
   */
  readonly #typeHoles: { readonly span: Source.Span; readonly type: Mono }[] = [];
  /**
   * The constraints **declared in this module**, by name.
   *
   * Ownership, never visibility. Two rules read exactly this set and nothing
   * wider: the orphan rule's "this module declares `C`" (Constraints §5.3,
   * Modules §7.2 — the file whose text contains the declaration), and the
   * base-constraint graph check, which is the home module's business and must
   * not be re-run — and re-reported — by every importer.
   */
  readonly #localConstraints = new Map<string, Resolved.ConstraintItem>();
  /**
   * Every constraint declaration this module can see, by identity: its own,
   * every one its imports name, and every one its import graph merely reaches.
   *
   * The last group is why this is keyed on identity rather than name, and it is
   * not decoration: a base chain's **middle link** can be private to the module
   * that wrote the chain, so no import anywhere names it, and the entailment
   * walk still has to read its bases to reach the far end. A name-keyed,
   * module-local table stops one hop short — which is not a diagnostic but a
   * demand to declare a constraint the module cannot spell, beside an emitted
   * `undefined` where the evidence should be (#276).
   */
  readonly #constraintsByIdentity = new Map<string, Resolved.ConstraintItem>();
  /**
   * The constraints whose **default-body helper** this module could name in
   * emitted JavaScript: the ones it declares (the helper is emitted beside the
   * instance, in this file) and the ones an `import` item names (that item is
   * the route the emitter renders the helper's import on).
   *
   * A declaration reached only through the visible-constraints *metadata*
   * channel is not here, and that group is exactly the prelude's: the
   * synthesized prelude import deliberately carries no constraints (#153,
   * `#preludeImport`), so there is no import statement to hang a helper on, and
   * the declaration is in another file so no local helper is emitted either.
   * §6.5's fork therefore cannot apply to a prelude declaration in either
   * direction — not hoisted (no route) and not materialized (its default body
   * was typed in another module, so this checker's tables cannot reconstruct
   * it). What answers those defaults instead is the compiler's own wired-in
   * completion, which predates the declarations and is what the pre-registered
   * inventory means: `Eq`'s `notEquals` is completed by the emitter for every
   * instance that omits it, declaration or no declaration.
   *
   * Without this gate the two answers are emitted *both*, as duplicate keys of
   * one instance literal — a hoisted-fork `notEquals` calling an unbound
   * `__default…` beside the wired-in one. JavaScript takes the last key, so
   * the damage depends on emission order: usually the wired one wins and the
   * broken reference dangles unreachable, but where the order runs the other
   * way the call is a `ReferenceError` after a clean compile. Neither shape is
   * visible to a test that only runs the program, which is why the pin for this
   * reads the emitted text (`constraint-member-exports.test.ts`, "the inherited
   * default emits no reference to a helper that cannot travel").
   *
   * The consequence to know when adding a prelude constraint (#335): a
   * *defaulted* member of one needs wired-in completion to match, because the
   * declaration's own body will not travel.
   */
  readonly #reachableConstraintHelpers = new Set<string>();
  /** Identities of constraints carrying implied type members; see §7's binder ban. */
  readonly #projectionBearingConstraints = new Set<string>();
  readonly #instanceTypeParameters = new WeakMap<
    Resolved.HonorItem,
    ReadonlyMap<string, Variable>
  >();
  readonly #instanceSubjects = new WeakMap<Resolved.HonorItem, Mono>();
  /**
   * Each instance's `type Name = τ` bindings, elaborated once — against the
   * same binder scope as the subject, which is what makes `type Item = a` and
   * `Bag(a)` share one variable (Collections Part 2 §5.3: "checking proceeds
   * with the substitution applied"). Filled beside `#instanceSubjects` for
   * source instances and imported ones alike; member checking, requirement
   * discharge, and the public surface all read this store rather than
   * re-elaborating the annotation, because each re-elaboration chooses a scope
   * again, and choosing differently is exactly #388.
   */
  readonly #instanceImpliedTypes = new WeakMap<
    Resolved.HonorItem,
    ReadonlyMap<string, Mono>
  >();
  readonly #instanceBaseConstraints = new WeakMap<Resolved.HonorItem, readonly Requirement[]>();
  /**
   * The component demands a derived instance raised, kept rather than discarded
   * (#278). Emission renders this selection instead of re-deriving each
   * component structurally.
   */
  readonly #instanceComponents = new WeakMap<Resolved.HonorItem, readonly RequirementComponent[]>();
  /**
   * Instances this pass **refused before checking their member bodies** — the
   * `#inferItems` `Honor` arm's `continue`s that fire ahead of member inference
   * (#651).
   *
   * The set exists because `#materializeItem` walks an item's members whatever
   * the diagnostics said, and that walk is the one part of the arm which is not
   * defensive: `#materializeUnwidenedExpr` dereferences `#requirements` for an
   * integer literal, for a string interpolation, and for a `hash(…)` call, and
   * a body no inference ever visited leaves all three empty. Any refused member
   * body carrying one therefore crashed the checker — Collections Part
   * 2 §4.1's own worked example (`hash(u) = u.n * 31`) among them, and the
   * identical crash sat behind the unknown-constraint refusal beside it.
   *
   * Recording the refusal is the repair that fits the arm: the members were
   * never typed, so there is nothing to materialize.
   *
   * **What happens downstream is measured, not assumed.** `compileProject` runs
   * `elaborate`, `emitJavaScript` and `emitDeclarations` *unconditionally*, so
   * an erroring module reaches all three — which is precisely why the emitter
   * reads `module.diagnostics` into `#alreadyDiagnosed` at all. The refused
   * instance therefore *is* elaborated and *is* emitted; it simply carries an
   * empty member list, and every consumer handles that, the emitted dictionary
   * coming out as `const __Hash_UserId = {  };` with both emitters completing
   * and adding no diagnostic of their own. What makes that harmless is not that
   * nothing sees it but that nothing *runs* it: a project carrying errors is
   * never executed. Whoever edits this must not read "the emitter never sees a
   * refused instance" out of it — the emitter sees it, and the empty list is
   * the contract it is being handed.
   *
   * Inferring the bodies anyway was the alternative and is the wrong one here:
   * the ordinary path would check them against a declaration the refusal has
   * just ruled out — or, at an unknown constraint, against no declaration at
   * all — turning one true refusal into a spray of consequences.
   */
  readonly #uninferredInstanceMembers = new WeakSet<Resolved.HonorItem>();
  readonly #mutableSymbols = new Set<Resolved.SymbolId>();
  /**
   * The unsolved variable each `var`'s monotype *is*, by variable id, with the
   * `var`'s name (Statements §6.1's function-type ban, #700).
   *
   * The ban's second arm is the **pinning use** — the use that settles an
   * unsolved monotype to an arrow — and this is where `#bind` looks to know
   * whether the variable it is about to settle belongs to a `var`. Keyed on the
   * variable rather than the symbol because that is what unification holds, and
   * the diagnostic wants the pinning use's span, which only unification has.
   */
  readonly #pinnedVars = new Map<number, string>();
  /**
   * The `fun` block heads whose binder list has already taken Modules §4.1.1's
   * maximality check (#700).
   *
   * The check is the *list's*, and one block has one list however many members
   * export under it — so it is asked once. Block ids are minted per file and a
   * `Checker` is built per module, so the id is identity enough here.
   */
  readonly #checkedBlockHeads = new Set<number>();
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
  /**
   * Which rigid variables are `honor` binders and which are constraint
   * subjects, by variable id. `#acceptRequirement`'s rejection wording is the
   * only reader: the rewrite a rejection must name differs by declaration site
   * (Rewrite Rule), and nothing else about rigidity does.
   */
  readonly #honorBinderVariables = new Set<number>();
  readonly #constraintSubjectVariables = new Set<number>();
  readonly #diagnostics: Diagnostics.Bag;
  readonly #importedSchemes: ReadonlyMap<Resolved.SymbolId, Typed.Scheme>;
  readonly #programNominals: VarianceDeclarations;
  readonly #programOperations: ProgramOperations;
  /**
   * The companion operations this module's dot calls reached with no import to
   * name them by (Method Syntax §8.2), by symbol — the input to
   * `Typed.Module.companionImports`.
   *
   * Recorded at the resolved call rather than swept from the index afterwards:
   * an entry is an `import` line in the emitted file, and the index holds every
   * operation of every nominal the program declares.
   */
  readonly #companionImports = new Map<Resolved.SymbolId, Typed.CompanionImport>();
  /** Where each operation in the program table came from, by symbol. */
  readonly #operationHomes = new Map<Resolved.SymbolId, ProgramOperation>();
  /** This module's file id, held for constraint identity; set by `check`. */
  #fileId = 0;
  /**
   * Whether the `let` pattern being checked is a lambda parameter's
   * destructuring (Pattern Matching §6.5) rather than a written binding. Read
   * only by `#matchFunctionFixit`.
   */
  #patternSeatIsLambdaParameter = false;
  /**
   * Every symbol bound as a **lambda parameter** — the match function's
   * compiler-fresh binder included, since the form is a lambda by desugar
   * (Pattern Matching §6.7).
   *
   * Read only by the §6.1 refusal, to tell the two abstract scrutinees apart: a
   * *declared* variable is determined and abstract by declaration, and keeps the
   * constraint-operations advice; a lambda parameter still sitting on an
   * *undetermined* inference variable is a program no seat determined, and takes
   * the rider that teaches the spellings #513 makes work.
   */
  readonly #lambdaParameters = new Set<Resolved.SymbolId>();
  #nextVariable = 0;

  constructor(diagnostics: Diagnostics.Bag, options: CheckOptions) {
    this.#diagnostics = diagnostics;
    this.#importedSchemes = options.importedSchemes ?? new Map();
    this.#programNominals = options.programNominals ?? { unions: [], records: [] };
    this.#programOperations = options.programOperations ?? new Map();
  }

  check(module: Resolved.Module): Typed.Module {
    this.#fileId = Number(module.fileId);
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
    this.#modulePath = module.path;
    this.#preludeUnionIds = new Set(module.preludeUnions.values());
    this.#preludeRecordIds = new Set(module.preludeRecords.values());
    this.#buildSpellingTables(module);
    // The fallback is deliberately guarded on the prelude being *absent
    // entirely*, not merely on `Bool` being missing from it. Reaching for a
    // locally declared `Bool` in any other circumstance would hand a user's own
    // `union Bool` the pin and the structural instances (#147). Only one module
    // satisfies the guard: `stdlib/Bool.hex`, declaring what the prelude cannot
    // yet supply to it. The emitter and the specialization planner use the same
    // form; they must agree, or one pass pins what another does not.
    this.#companionPrimitive = module.companionPrimitive;
    this.#boolUnion = module.preludeUnions.get("Bool")
      ?? (module.preludeUnions.size === 0
        ? module.unions.find((union) => union.name === "Bool")?.id
        : undefined);
    this.#verifyPinnedBoolShape(module);
    this.#verifyVarianceClaims(module);
    this.#rejectTypeHoles(module);
    for (const externType of module.externTypes) {
      this.#externTypes.set(externType.externType, externType);
    }
    // Every import form, not just `import module`: a companion dot call emits the
    // *local* spelling, and a named import — including the synthesized prelude
    // one — may bind a symbol under a dodging local (`__prelude_map`) to
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
    // Metadata for everything the import graph reaches, keyed on identity —
    // including declarations this module can never name, which is the group the
    // channel exists for (§5.1.1, and `#constraintsByIdentity`).
    for (const declaration of module.visibleConstraints) {
      this.#constraintsByIdentity.set(declaration.identity, declaration);
      if (declaration.impliedTypes.length > 0) {
        this.#projectionBearingConstraints.add(declaration.identity);
      }
    }
    for (const item of module.items) {
      if (item.kind === "ConstraintDeclaration") {
        this.#constraintNames.add(item.name);
        this.#constraintIdentities.set(item.name, item.identity);
        this.#localConstraints.set(item.name, item);
        this.#constraintsByIdentity.set(item.identity, item);
        this.#reachableConstraintHelpers.add(item.identity);
        if (item.impliedTypes.length > 0) {
          this.#projectionBearingConstraints.add(item.identity);
        }
      }
      // The one place an imported constraint's identity joins the name→identity
      // view; every name-taking call site downstream reads it unchanged.
      if (item.kind === "Import") {
        if (item.form.kind === "Namespace") {
          const alias = item.form.alias;
          const prefix = `${alias}.`;
          const exported = item.constraints
            .filter(({ local }) => local.startsWith(prefix))
            .map(({ local }) => local.slice(prefix.length));
          if (exported.length > 0) {
            this.#aliasConstraints.set(alias, { specifier: item.specifier, exported });
          }
        }
        for (const { local, declaration } of item.constraints) {
          this.#constraintNames.add(local);
          this.#constraintIdentities.set(local, declaration.identity);
          this.#constraintsByIdentity.set(declaration.identity, declaration);
          this.#reachableConstraintHelpers.add(declaration.identity);
          if (declaration.impliedTypes.length > 0) {
            this.#projectionBearingConstraints.add(declaration.identity);
          }
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
    // Collections Part 5 §4's provided rows, in the same evidence universe as
    // every other instance and seeded from the same place. They arrive after
    // the two import channels because they are neither: no module declares
    // them, so there is nothing for a duplicate check to be *against* — a user
    // `honor Iterable<Vector(a)>` is refused by the orphan rule long before it
    // could reach a slot (§7.3).
    this.#seedProvidedIterableRows(module);
    for (const item of module.items) {
      if (item.kind === "Honor") {
        this.#checkInstanceHead(item, module.items);
        // An instance's parameters are declared type variables, exactly as a
        // lambda's `<a: Render>` binders are: rigid, so `#bind` keeps them as
        // their class's representative and rejects binding them to a concrete
        // type. Rigidity is load-bearing, not cosmetic — a plain quantified
        // variable can be absorbed into a body-side fresh variable (a match
        // pattern's, for one), after which `#pinInstanceSubject`'s freshening
        // misses (it is keyed on this variable's id) and the first concrete use
        // site unifies the shared subject with its own type. Every later use
        // and the member bodies then compile against that one type, silently.
        const typeParameters = new Map(
          item.typeParameters.map((parameter) => [
            parameter.name,
            this.#fresh(
              0,
              false,
              parameter.name,
              parameter.constraints.filter((constraint) =>
                this.#constraintNames.has(constraint) &&
                !this.#bearsProjection(constraint)
              ),
            ),
          ] as const),
        );
        // A parameterized head introduces its own binders (#390). The head's
        // free type variables ARE this instance's binders whether or not the
        // `<...>` prefix declares them — the prefix exists to *constrain* them,
        // so `honor Iterable<Bag(a)>` is the canonical unconstrained spelling
        // and `honor<a: Eq> Eq<Pair(a, b)>` a lawful partial one.
        //
        // Minting them here — after the declared ones, before the registration
        // below, and before the subject elaborates — is what makes them real
        // binders rather than an artifact. `#annotationType`'s TypeVariable arm
        // writes an unknown lowercase name into a mutable binder map, so a
        // binder-less head used to acquire its variables *behind* this loop:
        // rigid by accident, but in neither `#quantified` nor
        // `#honorBinderVariables`, so defaulting could settle one and the
        // header fixit could never name it. Declared first, then head order, so
        // the map's order is the header's reading order.
        for (const name of headBinderNames(item.subject)) {
          if (typeParameters.has(name)) continue;
          // `[]` and not `undefined` for `declaredConstraints`: an undeclared
          // head binder is exactly `honor<a>`'s `a` — declared without
          // constraints — and it is that empty list which turns a member body's
          // requirement into §4.1's refusal with the `honor` header's rewrite
          // instead of leaving the requirement to accumulate.
          typeParameters.set(name, this.#fresh(0, false, name, []));
        }
        // Quantified besides being rigid: `honor<a: Render>` binds `a`, so it
        // is never an unresolved variable for defaulting to settle — nor one
        // for §4's blocked-defaulting report to name.
        for (const variable of typeParameters.values()) {
          this.#quantified.add(variable.id);
          this.#honorBinderVariables.add(variable.id);
        }
        this.#instanceTypeParameters.set(item, typeParameters);
        for (const parameter of item.typeParameters) {
          const variable = typeParameters.get(parameter.name)!;
          for (const constraint of parameter.constraints) {
            if (!this.#constraintNames.has(constraint)) {
              this.#diagnostics.add({
                severity: "error",
                ...this.#unknownConstraint(constraint),
                primary: parameter.span,
              });
              continue;
            }
            if (this.#bearsProjection(constraint)) {
              this.#diagnostics.add({
                severity: "error",
                message: impliedTypeBinderMessage(constraint, this.#constraintIdentity(constraint)),
                primary: parameter.span,
              });
              continue;
            }
            // The "annotation" origin mirrors the lambda binder's call and is
            // defensive, not load-bearing: every constraint required here is
            // also in `declaredConstraints`, so `#acceptRequirement` would
            // admit it through `#baseConstraintPath(c, c)` regardless.
            this.#require(constraint, variable, parameter.span, "annotation");
          }
        }
        const subject = this.#annotationType(
          item.subject,
          0,
          new Map(),
          typeParameters,
        );
        this.#instanceSubjects.set(item, subject);
        this.#storeInstanceImpliedTypes(item, typeParameters, true);
        const key = this.#instanceKey(item.constraintIdentity, subject);
        const occupant = this.#instances.get(key);
        if (occupant !== undefined) {
          // Both instances answer the *same* declaration — that is what a key
          // collision now means — so §5.1.1's disambiguation rule leaves the
          // name bare: there is one constraint to name, and qualifying it by
          // declaring module would print the same module twice.
          //
          // Silent when the occupant is a provided row: Collections Part 5 §7.3
          // pins that a duplicate-instance error proper is *unreachable* for a
          // prelude pair from user code, because satisfying the orphan rule
          // would mean editing the prelude. The orphan report is the one that
          // fires, and `#providedRowNote` appends the fact the user needs.
          //
          // **The one silent path this opens, for whoever edits the prelude
          // next.** From user code the suppression is unreachable twice over: a
          // structural head (`Vector(a)`, `Map(k, v)`, `Set(a)`) is refused
          // outright by `#checkInstanceHead` (Constraints §5.4), and a user file
          // declares neither `Iterable` nor any provided row's subject, so it
          // fails the orphan rule and gets the report either way. Inside
          // `stdlib/Iterable.hex` both guards lift at once: it *declares* the
          // constraint, so `ownsConstraint` holds and no orphan error fires, and
          // a nominal head slips past the head check — so a hand-written
          // `honor Iterable<Seq(a)>` there would collide with the seeded `Seq`
          // row and be **dropped without a diagnostic**. Nothing writes one
          // today, and nothing should: the rows have no source form by ruling
          // (§4), which is what this whole branch is downstream of. If that ever
          // changes, this suppression is where the silence lives.
          //
          // Deliberately not fixed by narrowing the condition. A report here
          // would have to name a duplicate of an instance with no source span
          // to point at, and inventing one is worse than the comment.
          if (!this.#providedIterableRows.has(occupant)) {
            this.#diagnostics.add({
              severity: "error",
              message: `duplicate instance of \`${item.constraint}<${this.#display(subject)}>\``,
              primary: item.span,
            });
          }
        } else {
          this.#admitInstance(key, item.constraintIdentity, subject, item);
          this.#instanceIdentities.set(
            key,
            `${Number(module.fileId)}:${item.dictionary}`,
          );
        }
      }
    }
    for (const item of module.items) {
      if (item.kind !== "ConstraintDeclaration") continue;
      // A constraint's subject is a declared type variable and must be rigid
      // for the same reason an instance's parameters are (see the Honor arm
      // above): a default member body can absorb the subject into a body-side
      // fresh variable, after which the first member use at a concrete type
      // binds the shared subject to that type — every other instance's copied
      // default then resolves the member against the first use's dictionary.
      // Declaring the constraint itself covers a default body's own member
      // uses, and reaches base constraints through `#baseConstraintPath`.
      const subject = this.#fresh(0, false, item.subject, [item.name]);
      // Quantified besides being rigid: the subject is bound by the
      // declaration, so it must never participate in ordinary
      // unresolved-variable defaulting, even when the constraint happens to
      // have an Int instance.
      this.#quantified.add(subject.id);
      this.#constraintSubjectVariables.add(subject.id);
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
          constraintIdentity: item.identity,
          constraintSubject: subject,
          impliedTypes,
        });
      }
    }
    this.#checkBaseConstraintGraph();
    // The default *bodies* are not checked here. The schemes above are what
    // earlier items need in order to name a member; the bodies need every
    // registration this method performs below — unions, records, exceptions,
    // companion operations — and the schemes of the module bindings §2 puts in
    // their scope, which only `#inferItems` seeds. So they are checked at the
    // declaration's own seat in `#inferItems`, in source order.

    // Exceptions §1 delegates a catch arm to Unions §4.2's flat constructor
    // patterns, and Modules §3.3's qualified form is one of them — so the table
    // a catch arm is read against has to be every exception constructor *in
    // scope*, not the ones this file happens to declare (#469). The prelude
    // layer's and the imports' arrive first; the module's own overwrite them
    // below, which changes nothing (a declaration is in one of the two sets, not
    // both) and keeps the loop that validates their slots the single place a
    // written `exception` is checked.
    //
    // Only the declaration crosses. The imported constructor's *scheme* is the
    // exporter's, already seeded from `importedSchemes`, and re-deriving it here
    // from the annotations would give the same type by a second route.
    for (const declaration of module.visibleExceptions) {
      this.#exceptions.set(declaration.binding.symbol, declaration);
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
          // #370, §3.4's constraint grant: a written binder is seeded *before*
          // the annotations are interned, so the annotation's `k` finds this
          // variable rather than minting a second, unbounded one — and the
          // requirement registered here is what `#publicScheme` reads back as
          // the row's residual constraint. From that point the binding is an
          // ordinary constrained function: ordinary discharge at every call,
          // ordinary trailing evidence in the emitted call, which is precisely
          // what the lowering (a compiled `<k: Hash>` runtime operation) expects.
          for (const parameter of declaration.typeParameters ?? []) {
            const bounds = parameter.constraints.filter((constraint) =>
              this.#constraintNames.has(constraint) && !this.#bearsProjection(constraint)
            );
            const variable = this.#fresh(0, false, parameter.name, bounds);
            // Quantified besides being rigid, exactly as an `honor` binder is:
            // the scheme below quantifies it, so it is never an unresolved
            // variable for the defaulting step to settle. Without this, `<k:
            // Hash>` on a declaration with no call sites at all defaults `k` to
            // `Int` and then reports the row as requiring `Int` — a true
            // sentence about a state defaulting had just created.
            this.#quantified.add(variable.id);
            typeParameters.set(parameter.name, variable);
            for (const constraint of parameter.constraints) {
              if (!this.#constraintNames.has(constraint)) {
                this.#diagnostics.add({
                  severity: "error",
                  ...this.#unknownConstraint(constraint),
                  primary: parameter.span,
                });
                continue;
              }
              if (this.#bearsProjection(constraint)) {
                this.#diagnostics.add({
                  severity: "error",
                  message: impliedTypeBinderMessage(constraint, this.#constraintIdentity(constraint)),
                  primary: parameter.span,
                });
                continue;
              }
              this.#require(constraint, variable, parameter.span, "annotation");
            }
          }
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
          // An extern `let` is a value reference, and a value reference carries
          // no colour (FFI Part 4 §4.5 — the same sentence that refuses `pure`
          // here). So it is not a signature, and a `->?` written in its
          // annotation takes §4.4's no-signature clause rather than being told
          // that a signature it does not have has no inlet (§2.2.2).
          this.#schemes.set(declaration.binding.symbol, {
            variables: [],
            type: this.#inPosition(
              "no-signature",
              () => this.#annotationType(declaration.annotation),
            ),
          });
          continue;
        }
        // An extern row is a signature like any other (Effects §2.2.1): a
        // `->?` written in one of its parameters is that signature's colour,
        // and FFI Part 4 §4.5's promise that "function-typed slots inside its
        // declared signature carry whatever arrows the author writes" is only
        // true if this scope is open. Without it every such arrow took §4.4's
        // orphan branch and was refused by a report that denied the parameter
        // in front of it.
        const externLinked = signatureInlet(
          declaration.parameters.map((parameter) => parameter.annotation),
          declaration.returnAnnotation,
        );
        const enclosingSignature = this.#openSignature(
          externLinked ? "open" : "clear",
          0,
          declaration.span,
        );
        const externFace = this.#signatureFace;
        const parameters = declaration.parameters.map((parameter) => {
          const type = parameter.annotation === undefined
            ? ERROR
            : this.#annotationType(parameter.annotation);
          this.#schemes.set(parameter.symbol, { variables: [], type });
          return type;
        });
        const externResult = this.#annotationType(declaration.returnAnnotation);
        this.#closeSignature(enclosingSignature);
        // Effects §6.1: a user-written extern is trust territory, so it is
        // effectful by default; `pure fun …` is the trusted claim that opts
        // out. Compiler-owned intrinsic rows never reach here — they take the
        // branch above and keep their pure faces, because intrinsics §4.2
        // *verifies* them rather than trusting them, which is the whole reason
        // the default splits by ownership.
        //
        // The row's *own* colour is that default; the signature's variable
        // belongs to the callback slots it declares, and is quantified so each
        // caller instantiates it afresh. Left unquantified it would be one
        // module-global variable that the first call site pinned for every
        // other — the same trap the intrinsic branch's snapshot comment names.
        //
        // #409's third arm: `conduit` seats that same variable at the row's
        // *outer* arrow too, so the row is exactly as effectful as its
        // callbacks, jointly. Nothing FFI-specific follows from it — the face
        // is an ordinary linked face, and callers get §3.3's machinery
        // unchanged. The claim needs a `->?` to link to, and a row that offers
        // none is refused rather than quietly re-read (§4.4's own sentence).
        const conduitClaim = declaration.conduit;
        const conduitColour = conduitClaim === undefined
          ? undefined
          : externLinked && externFace !== undefined
          ? externFace.effect
          : (this.#reportUnlinkedConduit(conduitClaim), undefined);
        const externEffect = conduitColour ??
          (declaration.pure !== true ? IMPURE : undefined);
        this.#schemes.set(declaration.binding.symbol, {
          variables: externLinked && externFace !== undefined ? [externFace.effect] : [],
          type: {
            kind: "Function",
            ...(externEffect === undefined ? {} : { effect: externEffect }),
            parameters,
            result: externResult,
          },
        });
      }
    }
    for (const record of module.records) {
      this.#records.set(record.id, record);
      this.#recordConstructors.set(record.constructor.symbol, record.id);
      const typeParameters = new Map(
        record.parameters.map((name) => [name, this.#fresh(0, false)] as const),
      );
      this.#recordParameters.set(record.id, typeParameters);
      const fields = this.#inPosition("record", () =>
        new Map(record.fields.map((field) => [
          field.name,
          this.#annotationType(field.annotation, 0, new Map(), typeParameters),
        ])));
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
        const slotParameters = this.#inPosition("union", () =>
          constructor.slots.map((slot) =>
            this.#annotationType(slot.annotation, 0, new Map(), typeParameters)
          ));
        this.#schemes.set(constructor.binding.symbol, {
          variables: [...typeParameters.values()],
          type: slotParameters.length === 0
            ? type
            : { kind: "Function", parameters: slotParameters, result: type },
        });
      }
    }
    this.#indexCompanionOperations(module);
    this.#inferItems(module.items, 0, true);
    // Constraints §4.7, in the order the two checks depend on. The signature
    // check needs every scheme seeded, so it cannot run before the items; the
    // **derived members** need its verdict, because a declaration that does not
    // widen has no restriction to derive and a second report at the honor block
    // would be the same fault said twice, in the wrong place — which is the
    // dependency, load-bearing and measured, that this ordering exists for.
    this.#checkWidensDeclarations(module.items);
    for (const { key, check } of this.#derivedMembers) {
      if (!this.#failedWidens.has(key)) check();
    }
    this.#derivedMembers = [];
    // The outermost deadline. Every region has finalised by now, so a goal still
    // pending here belongs to one that never generalises — a module-level
    // expression item, an honor block's member — and its receiver will never
    // become known: it takes the defaulting step and the fallback like any other
    // survivor, before the remaining variables settle.
    this.#resolveDotCallGoals(-1);
    this.#defaultRemainingVariables();
    // Before any scheme is externalised: an exported face has to carry the
    // colour its body proved (Modules §4.1.1), and #355 ruling 9 is what makes
    // that colour computable from the interface alone.
    this.#settleEffects();
    this.#checkPublicSignatures(module.items);
    this.#refuseExportedMemberSpellings(module.items);

    const symbols = module.symbols.map((symbol) => ({
      ...symbol,
      scheme: this.#publicScheme(this.#scheme(symbol.id)),
    }));

    return {
      kind: "Module",
      fileId: module.fileId,
      items: module.items.map((item) => this.#materializeItem(item)),
      symbols,
      // The reached ones ride out beside the listed ones, and after them: the
      // emitter builds its constructor table and its tagged/untagged judgment
      // from this list, so a union registered lazily during the walk above would
      // otherwise be emitted as if it had no representation at all (#605).
      // Appended rather than merged, because two consumers still pick the
      // prelude's `Bool` out of the list by *name*, and first found must stay
      // the one the eager listing put there.
      unions: [
        ...module.unions.map((union) => this.#materializeUnion(union)),
        ...[...this.#reachedUnions].map((union) =>
          this.#materializeUnion(this.#unions.get(union)!)
        ),
      ],
      records: module.records.map((record) => this.#materializeRecord(record)),
      preludeRecords: module.preludeRecords,
      preludeUnions: module.preludeUnions,
      preludeInstances: module.preludeInstances,
      preludeTypeImports: module.preludeTypeImports,
      visibleExceptions: module.visibleExceptions.map((declaration) =>
        this.#materializeException(declaration)
      ),
      externTypes: module.externTypes,
      comments: module.comments,
      docs: module.docs,
      typeHoles: this.#materializeTypeHoles(),
      companionImports: [...this.#companionImports.values()],
      span: module.span,
      diagnostics: this.#diagnostics.toArray(),
    };
  }

  /**
   * Builds §4.2's companion operation set for every nominal type this module can
   * name (`#companionOperations`).
   *
   * Run after the record and union loops above, so a nominal's *home file* — the
   * file its declaration's span points into, which is what `CompanionOf` means
   * by home module (§4.1, Modules §7.2) — is already known for imported copies
   * too, and before `#inferItems`, so every dot call in the module sees the
   * finished index.
   *
   * **Order-independence within the file is the point of reading annotations
   * rather than schemes.** A local `fun`'s scheme does not exist yet here: it is
   * seeded in `#inferItems`, in dependency order, so an index built from schemes
   * would answer differently depending on where in the file an operation was
   * written. §4.2 anticipates exactly this — `T`-headed "is a syntactic test, not
   * a unification question", and building the set is "a declaration-indexing
   * operation". Transparent aliases were already expanded by the resolver, which
   * is where §4.3's expansion happens.
   *
   * Imported operations have no declaration here to read, so their subject comes
   * from the imported scheme's first parameter — the head constructor of a type
   * the *exporting* module built from that same annotation. Reading a head is
   * not unification, and no candidate reaches this path without having crossed
   * an export boundary, which is where `#checkPublicSignatures` has already
   * demanded an annotation.
   *
   * **The nominal half is not this module's to decide (#585).** A nominal's
   * operations come from `#programOperations`, built by the *home* module from
   * its own exported declarations, because a set read off this module's symbol
   * table is a set built from whatever its imports happened to carry — and §4.2
   * says in as many words that no import adds or removes a dot-callable
   * operation. Reading it here made `Box({…}).double()` compile under `import
   * module B` and fail under `import { Box }`, with a message claiming the
   * companion exports no such operation while it plainly did.
   *
   * Two of this module's own views join it. `homeCompanionOperations(module)` is
   * what *this* file declares, which the program table cannot hold yet: it is
   * accumulated dependency-first and this module has not been compiled. The
   * symbol loop is the **built-in and primitive** channel, where membership is an
   * alias's export list rather than a home file because no declaration exists
   * for a home module to have indexed. That loop's nominal arm is now a subset of
   * the program table's answer and is kept for the lone `check` — one module,
   * no project — which is still a supported way to compile.
   */
  #indexCompanionOperations(module: Resolved.Module): void {
    for (const [subject, operations] of this.#programOperations) {
      for (const [name, operation] of operations) {
        const { symbol, scheme } = operation;
        // The scheme travels with the operation and is seeded here, once, if
        // nothing already holds one: a transitively reached operation is exactly
        // the one `importedSchemes` never saw, and a candidate with no scheme
        // reads downstream as a self-reference (`#dispatchCompanionOperation`).
        if (!this.#schemes.has(symbol.id)) {
          this.#schemes.set(symbol.id, this.#importScheme(scheme));
        }
        this.#operationHomes.set(symbol.id, operation);
        let found = this.#companionOperations.get(subject);
        if (found === undefined) {
          found = new Map();
          this.#companionOperations.set(subject, found);
        }
        found.set(name, symbol);
      }
    }
    for (const [subject, operations] of homeCompanionOperations(module)) {
      let found = this.#companionOperations.get(subject);
      if (found === undefined) {
        found = new Map();
        this.#companionOperations.set(subject, found);
      }
      for (const [name, symbol] of operations) found.set(name, symbol);
    }
    const home = new Map<string, number>();
    for (const record of module.records) {
      home.set(recordCompanionKey(record.id), Number(record.span.fileId));
    }
    for (const union of module.unions) {
      home.set(unionCompanionKey(union.id), Number(union.span.fileId));
    }
    // A built-in head's companion is the module addressable under its name
    // (`BUILTIN_COMPANIONS`), so membership is the alias's export list rather
    // than a file. An alias is the only evidence the checker has here, and it is
    // the same evidence `Vector.append(v, x)` already resolves through.
    const addressed = new Map<string, Set<Resolved.SymbolId>>();
    for (const alias of module.moduleAliases) {
      const key = BUILTIN_COMPANIONS.get(alias.alias) ??
        PRIMITIVE_COMPANIONS.get(alias.alias);
      if (key === undefined) continue;
      const members = addressed.get(key) ?? new Set<Resolved.SymbolId>();
      for (const member of alias.members) members.add(member.symbol);
      addressed.set(key, members);
    }
    const admit = (symbol: Resolved.Symbol | undefined, subject: string | undefined): void => {
      if (symbol === undefined || subject === undefined) return;
      // Symbol kind, not declaration shape: an intrinsic `extern fun` binds as
      // kind `fun` precisely so that it lands here (#134, `intrinsics.md` §8.1 —
      // `Seq.memoize` is the case), while an ordinary foreign `extern` binds as
      // kind `extern` and stays out, which is what makes a distinguished local
      // dispatch to the prelude (#266).
      if (symbol.kind !== "fun" && symbol.kind !== "let") return;
      // The home-module filter. Without it any module that merely *imports* `Box`
      // could add operations to it — the orphan-rule analogue §1 calls "one
      // companion, no search". A built-in head answers through its alias
      // instead; with no alias the lookup fails and its set stays empty.
      const members = addressed.get(subject);
      if (
        members === undefined
          ? home.get(subject) !== Number(symbol.bindingSpan.fileId)
          : !members.has(symbol.id)
      ) return;
      let operations = this.#companionOperations.get(subject);
      if (operations === undefined) {
        operations = new Map();
        this.#companionOperations.set(subject, operations);
      }
      operations.set(symbol.name, symbol);
    };

    for (const symbol of module.symbols) {
      // Everything this file declared has already been offered above, under the
      // export flag its item carries. A symbol from another file is in the table
      // only because an import put it there, and only exported names cross
      // (`moduleInterface`), so exportedness needs no second test here.
      if (Number(symbol.bindingSpan.fileId) === Number(module.fileId)) continue;
      const scheme = this.#schemes.get(symbol.id);
      if (scheme === undefined) continue;
      const type = this.#prune(scheme.type);
      if (type.kind !== "Function") continue;
      const first = type.parameters[0];
      admit(symbol, first === undefined ? undefined : this.#companionKeyOfType(first));
    }
  }

  /**
   * §4.2's second clause: the constraint members a receiver's type can be
   * dot-called through, by member name.
   *
   * Two sources, and both are table lookups — the section's "membership stays a
   * declaration-indexing operation". Instances honored at the type come from the
   * coherence table's reverse view; the compiler's **wired** primitive instances
   * (`Show<Int>`, `Integral<Int>`, …) come from `supports`, which is the same
   * table selection consults for them, so `42n.show()` needs no `BigInt.hex`.
   *
   * Non-subject-first members are collected too, flagged rather than dropped:
   * `fromNat` is not a spelling after a dot (§4.2), but §9 row 5 owes the reader
   * the near-miss rather than the flat "no such member".
   */
  #honoredMembers(type: Mono): ReadonlyMap<string, MemberCandidate[]> {
    const found = new Map<string, MemberCandidate[]>();
    const seen = new Set<string>();
    const admit = (identity: string): void => {
      if (seen.has(identity)) return;
      seen.add(identity);
      const declaration = this.#constraintsByIdentity.get(identity);
      if (declaration === undefined) return;
      for (const candidate of constraintMemberCandidates(declaration)) {
        found.set(candidate.member, [...found.get(candidate.member) ?? [], candidate]);
      }
    };
    const actual = this.#prune(type);
    for (const identity of this.#instancesBySubject.get(this.#subjectKey(actual)) ?? []) {
      admit(identity);
    }
    // A primitive needs no second channel since #344's last landing: its
    // instances are its companion's source `honor` blocks, which the
    // `#instancesBySubject` walk above already found. The wired table that used
    // to be consulted here for one is gone with the last companion.
    // `Bool` honors its four through the `derives` clause in `stdlib/Bool.hex`,
    // and the compiler answers requirements at it from the pin rather than from
    // those instances (#147, `#resolveRequirement`) — the prelude channel does
    // not even carry them. Honoring is what §4.2's clause asks about, and the
    // declaration honors, so the dot reaches the members either way.
    if (actual.kind === "Union" && actual.union === this.#boolUnion) {
      for (const name of ["Eq", "Ord", "Show", "Hash"]) {
        admit(preRegisteredConstraintIdentity(name));
      }
    }
    return found;
  }

  /**
   * §3.4's amended declared-type-variable row: the members a written binder puts
   * within reach, by member name.
   *
   * The bounds are the *entire* candidate set — no instance table is consulted
   * and no companion exists — and base constraints come with them (Constraints
   * §2.1: `a: Ord` entails `Eq`, so `x.equals(y)` is as available as
   * `x.compare(y)`).
   */
  #boundMembers(variable: Variable): ReadonlyMap<string, MemberCandidate[]> {
    const found = new Map<string, MemberCandidate[]>();
    const seen = new Set<string>();
    const admit = (identity: string): void => {
      if (seen.has(identity)) return;
      seen.add(identity);
      const declaration = this.#constraintsByIdentity.get(identity);
      if (declaration === undefined) {
        for (const base of PRE_REGISTERED_BASE_CONSTRAINTS[identity] ?? []) {
          admit(preRegisteredConstraintIdentity(base));
        }
        return;
      }
      for (const candidate of constraintMemberCandidates(declaration)) {
        found.set(candidate.member, [...found.get(candidate.member) ?? [], candidate]);
      }
      for (const base of declaration.baseConstraintIdentities) admit(base);
    };
    for (const constraint of variable.declaredConstraints ?? []) {
      admit(this.#constraintIdentity(constraint));
    }
    return found;
  }

  /** The companion identity a receiver's head names, or none for a headless one. */
  #companionKeyOfType(type: Mono): string | undefined {
    const actual = this.#prune(type);
    if (actual.kind === "NominalRecord") return recordCompanionKey(actual.record);
    if (actual.kind === "Union") return unionCompanionKey(actual.union);
    if (actual.kind === "Constructor") return PRIMITIVE_COMPANIONS.get(actual.name);
    return BUILTIN_COMPANIONS.get(actual.kind);
  }

  /**
   * Why this call site may not reach `operation`, or `undefined` if it may.
   *
   * A dot call is legal exactly where its qualified spelling is (Method Syntax
   * §4.4): within the home module the callee must be declared above the call,
   * and it is never a member of the caller's own `fun` block. Call sites in
   * other files see the whole exported surface — same file, not same module,
   * because textual order is what the rule is about.
   */
  #dotCallReachability(
    operation: Resolved.Symbol,
    callee: Resolved.AccessExpr,
    arguments_: readonly Resolved.Expr[],
    receiverType: Mono,
  ): string | undefined {
    if (this.#funGroups.some((members) => members.has(operation.id))) {
      const spelled = [
        callee.receiver.kind === "Name" ? callee.receiver.text : "…",
        ...arguments_.map(() => "…"),
      ];
      return "a dot call cannot target its own `fun` block; spell the call by " +
        `name: \`${operation.name}(${spelled.join(", ")})\``;
    }
    const call = callee.field.span;
    if (Number(operation.bindingSpan.fileId) !== Number(call.fileId)) return undefined;
    if (operation.bindingSpan.start.offset < call.start.offset) return undefined;
    return `\`${this.#display(receiverType)}\`'s companion declares ` +
      `\`${operation.name}\` below this call; declarations are read top-down — ` +
      "move the declaration above this call";
  }

  /**
   * §3.4's resolution table, for the receiver shapes that dispatch.
   *
   * Answers with the call's type when the dot resolved — to a companion
   * operation, to an honored member, to a bound member, or to a refusal — and
   * with `undefined` when the receiver is none of the dispatching shapes, which
   * is the caller's signal to let ordinary field and row machinery have the
   * expression (§3.5's fallback, byte for byte what it always was).
   */
  #dispatchDotCall(
    expression: Resolved.CallExpr,
    callee: Resolved.AccessExpr,
    receiver: Mono,
    level: number,
    cachedArguments?: readonly Mono[],
  ): Mono | undefined {
    const actual = this.#prune(receiver);
    const name = callee.field.text;
    if (actual.kind === "Variable") {
      // A **declared** variable dispatches through its written bounds and
      // nothing else (§3.4, amended 2026-08-07).
      if (actual.rigidName !== undefined) {
        return this.#dispatchBoundMember(
          expression, callee, receiver, actual, level, cachedArguments,
        );
      }
      // A *flexible* one pends: the receiver's type may still arrive from
      // anywhere in its owner region, and only at that region's deadline does
      // the defaulting step, and then the fallback, decide what it meant (§3.1).
      // `itemN` is not this table's business at all — tuple positional access is
      // its own row, and it errors on an unsolved receiver as it always has.
      if (cachedArguments !== undefined || /^item\d+$/u.test(name)) return undefined;
      const argumentTypes = expression.arguments.map((argument) =>
        this.#inferExpr(argument, level)
      );
      const result = this.#fresh(actual.level, false);
      this.#dotCallGoals.push({
        expression, callee, receiver, argumentTypes, result, level,
      });
      return result;
    }
    // `Seq` is a nominal record like any other, so `source.map(f)` is
    // ordinary companion dispatch (Products §3.2) against prelude
    // `Seq.hex` — no dedicated dot-call path, and no fixed operation list.
    const nominal =
      actual.kind === "NominalRecord" ||
      actual.kind === "Union" ||
      actual.kind === "Vector" ||
      actual.kind === "Set" ||
      actual.kind === "Map";
    // Primitives join the table for the member clause alone (§3.4's Primitive
    // row): they have no fields and no companion module, so the wired instances
    // are their whole dot surface — `42n.show()` is `Show`'s member at `BigInt`.
    const primitive_ = actual.kind === "Constructor";
    if (!nominal && !primitive_) return undefined;
    const recordHasField = actual.kind === "NominalRecord" &&
      this.#recordRepresentationVisible(actual.record) &&
      this.#nominalRecordFields(actual).has(name);
    // Type-directed, never lexical (§1): the receiver's head names one
    // companion, and only that companion's exported subject-first
    // operations are candidates (§4.2, `#companionOperations`). A
    // `Vector`, `Set`, or `Map` receiver reaches whatever module is
    // addressable under that name and nothing else, so in a project that
    // supplies none its set is empty and this takes the diagnostic below
    // rather than binding whatever prelude function happens to share the
    // name (#217).
    const companion = this.#companionKeyOfType(actual);
    const operation = companion === undefined
      ? undefined
      : this.#companionOperations.get(companion)?.get(name);
    const claimed = this.#honoredMembers(actual).get(name) ?? [];
    // Method Syntax §6.1's **one claimant** (#541, form #546): a companion's
    // `widens` binding and the members it supplies are one operation wearing
    // two widths, not rival sources. Dropping those members from the claimant
    // list is the whole of the carve — the call then takes the
    // companion-operation rewrite below, which under Modules §5.3's resolution
    // order is the operation's widest face.
    //
    // The declaration form is the whole test, and it is exact where a signature
    // comparison was only close: a `widens` of this spelling must name *every*
    // same-spelled member the module honors (§4.7's all-or-none corner), so
    // each of them is this one body's restriction. Same-spelled members with no
    // `widens` over them remain genuine rivals, count their full number, and
    // are refused exactly as before.
    const members = operation?.widens === true
      ? []
      : claimed.filter(({ subjectFirst }) => subjectFirst);
    if (members.length > 0) {
      const claimants = [
        ...(recordHasField ? [`a field \`${name}\``] : []),
        ...(operation === undefined
          ? []
          : [`a companion operation \`${this.#display(actual)}.${name}\``]),
        ...members.map((member) => `\`${member.constraint}\`'s member \`${name}\``),
      ];
      if (claimants.length > 1) {
        this.#dotCallArguments(expression, level, cachedArguments);
        return this.#unsupported(
          callee.field.span,
          `\`${name}\` after a dot is ambiguous at \`${this.#display(actual)}\`: ` +
            `${claimants.join(", ")}. Write ` +
            `${members.map((member) => this.#memberSpelling(member)).join(" or ")}` +
            `${
              operation === undefined
                ? ""
                : `, or \`${this.#display(actual)}.${name}(…)\` for the companion operation`
            }${recordHasField ? `, or \`(…​.${name})\` for the field` : ""}.`,
        );
      }
      return this.#elaborateMemberCall(
        expression, callee, receiver, members[0]!, level, cachedArguments,
      );
    }
    // A visible field still wins the fused form outright, exactly as it did
    // before members joined the candidate set. §6 makes field-versus-companion a
    // hard error too; that half is its own issue and nothing here changes it.
    if (recordHasField) return undefined;
    const scheme = operation === undefined ? undefined : this.#schemes.get(operation.id);
    // A candidate that exists but this call site may not reach is never
    // reported as a missing operation — that claim would be false (§4.4,
    // §9 rows 12–13).
    const unreachable = operation === undefined
      ? undefined
      : this.#dotCallReachability(operation, callee, expression.arguments, actual);
    // A candidate whose scheme is still missing, having passed the
    // reachability test, is the operation whose own right-hand side this
    // call sits in: a scheme is seeded when its item is inferred, so the
    // only reference that can precede one is a self-reference. `let` is
    // non-recursive, and the dot spelling does not change that (Functions
    // §6) — the resolver says so for the bare spelling, and this says it
    // in the same words for the dotted one.
    const selfReference = operation !== undefined && scheme === undefined &&
      unreachable === undefined;
    if (operation === undefined || scheme === undefined || unreachable !== undefined) {
      // Abandoning the call does not excuse the arguments: materialization
      // walks the whole resolved tree, and an integer literal's `FromNat`
      // requirement exists only if inference recorded one. Skipping them
      // leaves a bare literal with no requirement to dereference (#212).
      this.#dotCallArguments(expression, level, cachedArguments);
      return this.#unsupported(
        callee.field.span,
        unreachable ??
          (selfReference
            ? `\`${name}\` is not in scope in its own \`let\` definition; \`let\` is non-recursive — use \`fun\`.`
            : this.#noSuchOperation(actual, name, claimed)),
      );
    }
    // The evidence a **companion-resolved** dot call supplies (#370). It used
    // to collect none, on the reading that a companion operation's constraints
    // are the callee's own business — which was true for as long as no
    // companion operation had any. `stdlib/Map.hex`'s keyed trio is the first
    // that does, and `m.set(k, v)` has to append exactly the suffix
    // `Map.set(m, k, v)` appends, or the dot spelling silently calls the same
    // function one argument short (Method Syntax §1: the two spellings are one
    // call). An unconstrained operation collects an empty list, which is the
    // behaviour this replaces, unchanged.
    const requirements: Requirement[] = [];
    const calleeType = this.#instantiate(scheme, level, requirements, callee.field.span);
    const arguments_ = [
      receiver,
      ...this.#dotCallArguments(expression, level, cachedArguments, calleeType, receiver),
    ];
    const result = this.#fresh(level, false);
    const dotEffect = this.#calleeEffect(calleeType, level);
    this.#unify(
      calleeType,
      {
        kind: "Function",
        parameters: arguments_,
        result,
        effect: dotEffect,
      },
      expression.span,
    );
    this.#registerCall(expression, dotEffect, calleeLabel(expression));
    this.#recordCompanionImport(operation);
    this.#dotCalls.set(expression, {
      symbol: operation.id,
      name: operation.name,
      requirements,
      callee: calleeType,
      receiver: callee.receiver,
    });
    return result;
  }

  /**
   * Method Syntax §8.2, from the side that knows: a dot call resolved to an
   * operation this module has no name for, so emission owes the file an import
   * of it (#585).
   *
   * The two ways a module *does* have a name are both checked. `#operationSpellings`
   * holds every symbol an import item binds, namespace forms included — the dot
   * emits the local spelling, `B.double`, and there is nothing to add. A symbol
   * bound in this file is the home module's own dot call, spelled bare.
   *
   * Everything left is §4.2's import-insensitivity being paid for. The record is
   * the *home module's*: its path, its published constrainedness, and the
   * internal spellings it named its exports by — none of which this module could
   * reconstruct, precisely because it never imported it.
   */
  #recordCompanionImport(operation: Resolved.Symbol): void {
    if (this.#operationSpellings.has(operation.id)) return;
    if (Number(operation.bindingSpan.fileId) === this.#fileId) return;
    if (this.#companionImports.has(operation.id)) return;
    const home = this.#operationHomes.get(operation.id);
    // No home on record is the lone-`check` compilation, which has no module
    // graph and so no second file to import from either.
    if (home === undefined || this.#modulePath === undefined) return;
    this.#companionImports.set(operation.id, {
      symbol: operation.id,
      imported: operation.name,
      specifier: relativeSpecifier(this.#modulePath, home.path),
      constrained: home.scheme.constraints.length > 0,
      internalNames: home.internalNames,
    });
  }

  /**
   * The argument types of a dot call — inferred here, or replayed from the goal
   * that inferred them at the dot. Inferring twice would record a second copy of
   * every literal's requirement, so a goal carries what it measured.
   */
  #dotCallArguments(
    expression: Resolved.CallExpr,
    level: number,
    cached: readonly Mono[] | undefined,
    member?: Mono,
    receiver?: Mono,
  ): readonly Mono[] {
    if (cached !== undefined) return cached;
    // *(#513.)* §2.2's second entry moment: the receiver was head-known **at the
    // dot**, so the goal has already been created and resolved, and the call now
    // checks as a named call to the resolved member — its signature supplying
    // each argument's expected type, pointwise (Functions §4.3). The member's
    // first parameter is the receiver's, so the arguments read from index 1.
    //
    // `cached` is the other moment: a goal whose receiver was still unsolved at
    // the dot measured its arguments there, and they synthesized — the
    // known-callee condition being unmet. Evidence arriving later resolves the
    // dispatch identically but cannot retroactively hand expectations to
    // arguments already checked (§3.6).
    const known = member === undefined ? undefined : this.#prune(member);
    const parameters = known?.kind === "Function" &&
        known.parameters.length === expression.arguments.length + 1
      ? known.parameters
      : undefined;
    // The subject-first step, in the spelling that puts the subject *before* the
    // dot: the receiver is this member's first argument, and it was head-known
    // at the dot — that is the condition this whole path stands on. Unifying it
    // with the member's own first parameter is what resolves the instantiation,
    // so `xs.map(match …)` reads `Int` off `Seq(Int)` before the arms are
    // checked. It is the call's own unification, performed early and once; the
    // whole-signature unification below repeats it harmlessly.
    if (
      parameters !== undefined && receiver !== undefined &&
      expression.arguments.some(expectationLands)
    ) {
      this.#unify(parameters[0] ?? ERROR, receiver, expression.callee.span);
    }
    // §4.3's two passes, here as at a named call: non-lambda arguments in
    // source order, then lambda literals in source order, each expectation
    // pruned at its turn. The member's first parameter is the receiver's, so
    // the arguments read from index 1.
    const types: Mono[] = expression.arguments.map(() => ERROR);
    const deferredLambdas = new Set(
      expression.arguments.flatMap((argument, index) =>
        defersAsLambda(argument) ? [index] : []
      ),
    );
    const pass = parameters === undefined ? undefined : this.#argumentPass(
      parameters.slice(1),
      types,
      expression.arguments,
      expression.span,
    );
    for (const [index, argument] of expression.arguments.entries()) {
      if (deferredLambdas.has(index)) continue;
      types[index] = this.#inferExpr(argument, level, parameters?.[index + 1]);
    }
    if (deferredLambdas.size > 0) {
      // §2.2: the call "checks as a named call to the resolved member", and the
      // three spellings are one call (§1) — so the first pass resolves the
      // member's instantiation before the second reads its expectations, here
      // as at the qualified spelling. The receiver unification above covers
      // only the instantiation the *receiver* determines;
      // `xs.zipWith(ys, match …)` reads its callback's parameter type off the
      // sibling, and without this it would see a variable where
      // `Vector.zipWith(xs, ys, match …)` sees `Int`.
      for (const index of pass?.resolveInstantiation(deferredLambdas) ?? []) {
        types[index] = ERROR;
      }
      for (const index of deferredLambdas) {
        types[index] = this.#inferExpr(
          expression.arguments[index]!,
          level,
          parameters?.[index + 1],
        );
      }
    }
    return types;
  }

  /**
   * §3.3's deadline: the fixpoint, the defaulting step, then the fallback.
   *
   * Run at every generalisation boundary, over the goals that boundary **owns** —
   * the ones whose receiver lives in the region being finalised. A goal on an
   * outer-level receiver survives an inner `let`'s boundary untouched, which is
   * exactly what §11.10 rejects the per-binding deadline for: firing the
   * fallback there would make the meaning of independent sibling statements
   * depend on their order.
   *
   * The three steps are ordered, and the order is the amendment (§3.5): a
   * receiver whose constraint set is non-empty and entirely defaultable settles
   * to `Int` *before* any row is imposed, so `42.show()` is `Show`'s member at
   * `Int` exactly as bare `show(42)` is. Settling is the head-known trigger, so
   * the fixpoint runs again before the survivors take the fallback.
   */
  #resolveDotCallGoals(level: number): void {
    if (this.#dotCallGoals.length === 0) return;
    const owned = (goal: DotCallGoal): boolean => {
      const receiver = this.#prune(goal.receiver);
      return receiver.kind !== "Variable" || receiver.level > level;
    };
    // Chains make this a fixpoint, not a pass: resolving `v.map(f)` solves the
    // tyvar that is `take`'s receiver, which fires that goal's trigger in turn.
    const fixpoint = (): void => {
      for (let settled = true; settled;) {
        settled = false;
        for (const goal of [...this.#dotCallGoals]) {
          if (!owned(goal) || this.#prune(goal.receiver).kind === "Variable") continue;
          this.#dotCallGoals.splice(this.#dotCallGoals.indexOf(goal), 1);
          this.#settleDotCallGoal(goal);
          settled = true;
        }
      }
    };
    fixpoint();
    for (const goal of this.#dotCallGoals) {
      if (!owned(goal)) continue;
      const receiver = this.#prune(goal.receiver);
      if (
        receiver.kind === "Variable" && receiver.rigidName === undefined &&
        this.#canDefaultToInt(receiver)
      ) {
        this.#bind(receiver, primitive("Int"), goal.callee.field.span);
      }
    }
    fixpoint();
    for (const goal of [...this.#dotCallGoals]) {
      if (!owned(goal)) continue;
      this.#dotCallGoals.splice(this.#dotCallGoals.indexOf(goal), 1);
      this.#fallbackDotCallGoal(goal);
    }
  }

  /** A goal whose receiver became head-known: §3.4's table, replayed. */
  #settleDotCallGoal(goal: DotCallGoal): void {
    const type = this.#dispatchDotCall(
      goal.expression,
      goal.callee,
      goal.receiver,
      goal.level,
      goal.argumentTypes,
    );
    this.#unify(goal.result, type ?? ERROR, goal.expression.span);
    this.#expressionTypes.set(goal.expression, this.#prune(goal.result));
  }

  /**
   * §3.5's fallback: the surviving goal *is* a field call, and imposing the
   * callable-field requirement is the whole of it. It never rejects — an
   * unsatisfiable row errors through ordinary constraint discharge, in the
   * phrasing that machinery already owns (§11.8).
   */
  #fallbackDotCallGoal(goal: DotCallGoal): void {
    const field = this.#fresh(goal.level, false);
    this.#unify(
      goal.receiver,
      {
        kind: "Record",
        fields: new Map([[goal.callee.field.text, field]]),
        tail: this.#fresh(goal.level, false),
      },
      goal.callee.span,
    );
    this.#recordAccesses.set(goal.callee, goal.callee.field.text);
    this.#expressionTypes.set(goal.callee, field);
    // The imposed arrow is `->`, exactly as §3.5 writes it: a row is data, and a
    // data field's arrow is pure or the constant, never linked (Effects §2.5) —
    // and nothing here wrote the constant. So the call is pure, and a mark on it
    // is refused with §9's dot-call sentence. The obligation is registered on
    // *this* argument list (§3.2 ruling 2) and in the frame the call was written
    // in, which the deadline no longer describes.
    this.#unify(
      field,
      {
        kind: "Function",
        parameters: goal.argumentTypes,
        result: goal.result,
        effect: PURE,
      },
      goal.expression.span,
    );
    this.#registerCall(goal.expression, PURE, calleeLabel(goal.expression));
    this.#expressionTypes.set(goal.expression, this.#prune(goal.result));
  }

  /**
   * The spelling a refusal offers for one member — the qualified home, or the
   * **bare** name where the constraint's declaring module is this one.
   *
   * A module cannot name itself (Method Syntax §16.2), so `Loud.volume(x)` is
   * not a rewrite a reader of `loud.hex` can take. Inside the declaring module
   * the bare spelling is the member's own, and it is the one that resolves.
   */
  #memberSpelling(candidate: MemberCandidate): string {
    const local = [...this.#localConstraints.values()].some(
      (declaration) => declaration.identity === candidate.identity,
    );
    return local
      ? `\`${candidate.member}(…)\``
      : `\`${candidate.constraint}.${candidate.member}(…)\``;
  }

  /**
   * §9 row 4, now that the candidate set has three sources: the message must
   * account for all three, or it asserts something false about the two it does
   * not mention. Row 5's near-miss rides along — a member that exists but does
   * not take its constraint's subject first has a spelling, just not this one.
   */
  #noSuchOperation(
    actual: Mono,
    name: string,
    claimed: readonly MemberCandidate[],
  ): string {
    const display = this.#display(actual);
    const nearMiss = claimed[0];
    return `\`${display}\` has no field \`${name}\`, its companion exports no ` +
      `operation \`${name}\`, and no constraint honored at \`${display}\` has a ` +
      `subject-first member \`${name}\`` +
      (nearMiss === undefined
        ? "; call an available subject-first function explicitly"
        : `; \`${nearMiss.constraint}\`'s member \`${name}\` does not take its ` +
          `constraint's subject first — call it as \`${name}(…)\``);
  }

  /** §3.4's declared-type-variable row: the bounds, and nothing else. */
  #dispatchBoundMember(
    expression: Resolved.CallExpr,
    callee: Resolved.AccessExpr,
    receiver: Mono,
    variable: Variable,
    level: number,
    cachedArguments?: readonly Mono[],
  ): Mono {
    const name = callee.field.text;
    const claimed = this.#boundMembers(variable).get(name) ?? [];
    const members = claimed.filter(({ subjectFirst }) => subjectFirst);
    if (members.length === 1) {
      return this.#elaborateMemberCall(
        expression, callee, receiver, members[0]!, level, cachedArguments,
      );
    }
    this.#dotCallArguments(expression, level, cachedArguments);
    if (members.length > 1) {
      return this.#unsupported(
        callee.field.span,
        `\`${name}\` after a dot is ambiguous on \`${variable.rigidName}\`: ` +
          `${members.map(({ constraint }) => `\`${constraint}\``).join(" and ")} each ` +
          `declare a member \`${name}\`. Write ` +
          `${members.map((member) => this.#memberSpelling(member)).join(" or ")}.`,
      );
    }
    // §9 row 7. The bounds are the entire candidate set, so the message says so
    // and offers the three ways out — never the row constraint, which a declared
    // variable never takes.
    return this.#unsupported(
      callee.field.span,
      `\`${variable.rigidName}\` is a declared type variable, so \`.${name}\` can ` +
        "only be one of its constraints' members, and none of " +
        `\`${variable.rigidName}\`'s constraints has a subject-first member ` +
        `\`${name}\`; add the constraint to the parameter's binder, use a concrete ` +
        "nominal type, or call a qualified function",
    );
  }

  /**
   * Member dispatch's elaboration: the member applied to `(receiver, args…)`,
   * with the evidence its own scheme demands.
   *
   * "The same elaboration as the bare call at that type" (§3.4) is not a
   * resemblance — this instantiates the member's scheme and collects its
   * requirements exactly as a `Name` callee does, so selection, erasure, and
   * emission are the bare call's and the dot adds no shape of its own (§8.1).
   */
  #elaborateMemberCall(
    expression: Resolved.CallExpr,
    callee: Resolved.AccessExpr,
    receiver: Mono,
    candidate: MemberCandidate,
    level: number,
    cachedArguments?: readonly Mono[],
  ): Mono {
    const scheme = this.#schemes.get(candidate.symbol);
    if (scheme === undefined) {
      this.#dotCallArguments(expression, level, cachedArguments);
      return this.#unsupported(
        callee.field.span,
        `\`${candidate.constraint}\`'s member \`${candidate.member}\` has no ` +
          "signature here; call it by name",
      );
    }
    const requirements: Requirement[] = [];
    const calleeType = this.#instantiate(scheme, level, requirements, callee.field.span);
    const arguments_ = [
      receiver,
      ...this.#dotCallArguments(expression, level, cachedArguments, calleeType, receiver),
    ];
    const result = this.#fresh(level, false);
    const memberEffect = this.#calleeEffect(calleeType, level);
    this.#unify(
      calleeType,
      {
        kind: "Function",
        parameters: arguments_,
        result,
        effect: memberEffect,
      },
      expression.span,
    );
    this.#registerCall(expression, memberEffect, calleeLabel(expression));
    this.#dotCalls.set(expression, {
      symbol: candidate.symbol,
      name: candidate.member,
      requirements,
      callee: calleeType,
      receiver: callee.receiver,
    });
    return result;
  }

  /**
   * Whether this instance head names the primitive this module companions
   * (Constraints §5.3's "a primitive type's home module is its fixed prelude
   * companion" — #344).
   *
   * The one predicate behind both primitive carve-outs, so they cannot drift:
   * the orphan rule reads it as `ownsSubject`, and `Hash`'s derivable-only law
   * reads it as the privilege that admits a hand-written instance. It is false
   * in every module the compilation did not seat at a primitive's own injection
   * path — a user module honoring at `BigInt` is the orphan it always was, and a
   * user `honor Hash<BigInt>` keeps the refusal.
   */
  #companionsPrimitive(subject: Resolved.TypeAnnotation): boolean {
    return subject.kind === "Primitive" && subject.name === this.#companionPrimitive;
  }

  #checkInstanceHead(
    item: Resolved.HonorItem,
    moduleItems: readonly Resolved.Item[],
  ): void {
    const subject = item.subject;
    const nominal = subject.kind === "Union" || subject.kind === "RecordDeclaration";
    // A head is parameterized when it is *applied*, whether or not a `<...>`
    // prefix declares the binders (#390): the prefix attaches constraints, it
    // does not decide that the head has arguments. Reading the prefix alone let
    // `honor Eq<Pair(a, a)>` and `honor Show<Box(Int)>` past the law entirely,
    // the first honoring one constraint at two unrelated argument positions
    // through a single variable, the second keying a ground head on a
    // constructor the coherence table cannot tell apart from the generic one.
    if (item.typeParameters.length > 0 || (nominal && subject.arguments.length > 0)) {
      const arguments_ = nominal ? subject.arguments : [];
      const names = arguments_.flatMap((argument) =>
        argument.kind === "TypeVariable" ? [argument.name] : []
      );
      // Shape first: nominal, and applied once to each *distinct* variable. The
      // count against the prefix is gone with the prefix's new meaning — a
      // partial prefix declares fewer names than the head binds, which is the
      // point of allowing it.
      const lawful = nominal && names.length === arguments_.length &&
        new Set(names).size === names.length;
      if (!lawful) {
        this.#diagnostics.add({
          severity: "error",
          message: "a parameterized instance head must be a nominal constructor applied once to each distinct instance parameter",
          primary: item.subject.span,
        });
      } else {
        // Gated on the shape being lawful, so an unreadable head reports once
        // rather than once per binder it failed to mention.
        for (const parameter of item.typeParameters) {
          if (names.includes(parameter.name)) continue;
          this.#diagnostics.add({
            severity: "error",
            message: `instance binder \`${parameter.name}\` does not appear in the head; ` +
              "a binder exists to constrain one of the head's type variables — " +
              `remove it, or spell the head with \`${parameter.name}\``,
            primary: parameter.span,
          });
        }
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

    // **Declared here**, never merely visible or nameable here. Modules §7.2
    // defines the orphan rule's home module as the file whose text contains the
    // declaration, so an imported constraint gives this module no claim: it is
    // exactly the `honor ImportedC<ImportedT>` a third module must not write
    // (Constraints §5.3).
    const ownsConstraint = this.#localConstraints.has(item.constraint);
    const ownsSubject = this.#companionsPrimitive(subject) ||
      moduleItems.some((candidate) =>
        (subject.kind === "Union" && candidate.kind === "Union" && candidate.union === subject.union) ||
        (subject.kind === "RecordDeclaration" &&
          candidate.kind === "RecordDeclaration" &&
          candidate.record === subject.record)
      );
    if (!ownsConstraint && !ownsSubject) {
      this.#diagnostics.add({
        severity: "error",
        message: `orphan instance: this module declares neither \`${item.constraint}\` nor the instance subject` +
          this.#providedRowNote(item),
        primary: item.span,
      });
    }
  }

  /**
   * Collections Part 5 §7.3: when the slot a user tried to fill is one the
   * prelude already holds, the orphan error appends the fact.
   *
   * The orphan rule fires *first* for a provided row — the user's file declares
   * neither `Iterable` nor `Vector` — so a duplicate-instance error proper is
   * unreachable from user code for these pairs, and the useful thing to say is
   * not "this is illegal here" but "this already exists". The head is rendered
   * from the registered row's own subject, so the message names `Vector(a)`
   * rather than whatever the user wrote.
   */
  #providedRowNote(item: Resolved.HonorItem): string {
    // Read off the **annotation**, not the elaborated subject: head checking
    // runs before pass 1 stores the `Mono`, so `#instanceSubjects` is still
    // empty here. The key below is the same one `#subjectKey` mints, which is
    // what keeps this asking about the slot selection would actually use.
    const subject = item.subject;
    const key = subject.kind === "Vector"
      ? "vector"
      : subject.kind === "Map"
      ? "map"
      : subject.kind === "Set"
      ? "set"
      : subject.kind === "Array"
      ? "array"
      : subject.kind === "JsMap"
      ? "jsmap"
      : subject.kind === "JsSet"
      ? "jsset"
      : subject.kind === "Range"
      ? "range"
      : subject.kind === "Primitive"
      ? `primitive:${subject.name}`
      : subject.kind === "RecordDeclaration"
      ? `record:${Number(subject.record)}`
      : undefined;
    if (key === undefined) return "";
    const row = this.#instances.get(`${item.constraintIdentity}:${key}`);
    if (row === undefined || !this.#providedIterableRows.has(row)) return "";
    const head = this.#instanceSubjects.get(row);
    if (head === undefined) return "";
    return `; the prelude already provides \`${item.constraint}<${this.#display(head)}>\``;
  }

  #inferItems(
    items: readonly Resolved.Item[],
    level: number,
    moduleItems: boolean,
    expected?: Mono,
  ): Mono {
    // Ascription §3.1 scopes annotation variables to a *declaration*. Inside a
    // definition that scope already exists and every item shares it — a
    // body-local `let x: a` has always named the signature's `a`. At the top
    // level there is no enclosing definition, so each item is its own
    // declaration and starts its own scope; without this, two module-level
    // bindings that both write `a` would share one rigid variable, and the
    // second would meet one the first had already quantified.
    const enclosingVariableScope = this.#annotationVariableScope;
    // §2.2.2's second boundary: module level is outside every function
    // signature, so a `->?` written in a binding annotation, a `var`, or an
    // ascription here has neither an inlet of its own nor an enclosing colour to
    // borrow, and §4.4 says so in its own words. Every lambda inside restores
    // `"signature"` as it opens, so only the module's own type positions are
    // covered. A block's items are a body's, and keep whatever position the
    // enclosing lambda set.
    const enclosingPosition = this.#linkedArrowPosition;
    if (moduleItems) this.#linkedArrowPosition = "no-signature";
    for (let index = 0; index < items.length; index += 1) {
      const item = items[index];
      if (item === undefined) continue;
      if (enclosingVariableScope === undefined) this.#annotationVariableScope = new Map();

      // *(#700.)* A `fun` **block** is the one place a body may name a binding
      // written below it (Functions §7.3), so it is the one place inference
      // cannot simply follow the text. The block is typed as a unit here and the
      // walk resumes after it; everything outside one is reached in source
      // order, which is why every reference lands on a finished scheme. A fused
      // `fun` is the one-member block and takes the same path.
      if (item.kind === "Fun") {
        let end = index + 1;
        const block = item.block;
        while (block !== undefined) {
          const next = items[end];
          if (next?.kind !== "Fun" || next.block?.id !== block.id) break;
          end += 1;
        }
        this.#inferFunGroup(
          items.slice(index, end) as readonly Resolved.FunItem[],
          level,
        );
        index = end - 1;
        continue;
      }

      if (item.kind === "Let") {
        // A written face is the other place a signature lives (Effects §2.2).
        // The declaration form has no outer arrow, so `(Tx ->? a) ->! a` — the
        // const ⊔ var shape §2.4 settles — can only be written here, and
        // the scope has to be open before the body is inferred so that the
        // body's `?` has an inlet to join.
        const annotation = item.annotation;
        // §2.2.2: a written function type is a signature of its own exactly
        // when it carries its own inlet. Without one it is a *local type
        // position*, and its `->?` names the enclosing signature's variable —
        // which is what `"inherit"` keeps in scope. At module level there is
        // nothing to inherit, so the enclosing face is `undefined` and a `->?`
        // written here takes §4.4's no-signature clause.
        const linked = annotation !== undefined &&
          annotation.kind === "Function" &&
          signatureInlet(annotation.parameters, annotation.result);
        const enclosingSignature = this.#openSignature(
          linked ? "open" : "inherit",
          level + 1,
          item.span,
        );
        if (linked && annotation?.kind === "Function" && annotation.effect === "linked") {
          this.#signatureFace!.outer = annotation.arrowSpan;
        }
        this.#pendingInlet = linked;
        // The outer arrow, read from the face rather than inferred. A `->` face
        // is a pure demand on the body; `->!` is the impure constant; a linked
        // `->?` is the signature's own variable when this annotation is a
        // signature, and the *enclosing* signature's when it is a local
        // position borrowing one (§2.2.2). With neither, the arrow is refused
        // where the annotation is elaborated and this is §4.4's recovery.
        this.#pendingOwnEffect = annotation?.kind === "Function"
          ? (annotation.effect === "constant"
            ? IMPURE
            : annotation.effect === "linked"
              ? (this.#signatureFace?.effect ?? RECOVERED)
              : annotation.effect === undefined
                ? PURE
                : IMPURE)
          : undefined;
        if (
          annotation?.kind === "Function" &&
          annotation.effect === "constant" && annotation.arrowSpan !== undefined &&
          item.value.kind === "Lambda"
        ) {
          this.#constantFaces.push({
            lambda: item.value,
            arrowSpan: annotation.arrowSpan,
          });
        }
        // §4.3's first supplying seat: **an annotated `let`/`fun` right-hand
        // side** — the annotation is the expectation. It is elaborated here,
        // ahead of the value, only where an expectation can land (a lambda is
        // reachable through the forwarding forms); every other right-hand side
        // keeps the elaboration order it had, annotation after value. One
        // elaboration either way — the type computed here is the one the final
        // check below unifies with, so no seat ever elaborates its face twice.
        //
        // A partially annotated face supplies what it writes; its holes ride
        // along as the ordinary inference variables they elaborate to.
        const suppliedFace = annotation !== undefined && expectationLands(item.value)
          ? this.#inAnnotationPosition(annotation, () =>
            this.#annotationType(
              annotation,
              level + 1,
              new Map(),
              this.#annotationVariableScope ?? new Map(),
            ))
          : undefined;
        const inferredValueType = this.#inferExpr(item.value, level + 1, suppliedFace);
        this.#pendingInlet = false;
        this.#pendingOwnEffect = undefined;
        let valueType = inferredValueType;
        if (annotation !== undefined) {
          const annotationType = suppliedFace ??
            this.#inAnnotationPosition(annotation, () =>
            this.#annotationType(
              annotation,
              level + 1,
              new Map(),
              this.#annotationVariableScope ?? new Map(),
            ));
          this.#unifyExpected(
            annotationType,
            inferredValueType,
            item.value,
            annotation.span,
            true,
          );
          valueType = this.#hasNumericWidening(item.value)
            ? annotationType
            : this.#applyWrittenQualifiers(annotationType, valueType);
        }
        this.#closeSignature(enclosingSignature);
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
      if (item.kind === "ConstraintDeclaration") {
        // Constraints §2: "A default body is checked once in the constraint's
        // generic context against its declared return type. The constraint
        // subject, its base constraint operations, module-scope names, and all
        // members of the same constraint are in scope." The member schemes —
        // subject rigid, parameters seeded from the declared face — were built
        // when the declaration was registered; the *module-scope names* are the
        // ones seeded above this seat, which is exactly the set the resolver's
        // top-down law admits (a `fun` written below the constraint is refused
        // by name before this runs).
        for (const member of item.members) {
          const defaultValue = member.defaultValue;
          if (defaultValue === undefined) continue;
          const expected = this.#prune(this.#scheme(member.binding.symbol).type);
          if (expected.kind !== "Function") continue;
          defaultValue.parameters.forEach((parameter, index) => {
            this.#schemes.set(parameter.symbol, {
              variables: [],
              type: expected.parameters[index] ?? ERROR,
            });
          });
          // No `#openSignature` frame: a member declares its face in slots, not
          // as a written arrow, so there is no inlet to mint and a `->?` in the
          // body has nothing to link to — Effects §4.4's inlet-less signature,
          // which is the clause `"signature"` names. The module level around
          // this seat is `"no-signature"`, and that is the enclosing item's
          // answer, not this body's: a default body stands under a declared
          // signature exactly as a `fun` body does.
          const body = this.#inPosition(
            "signature",
            () => this.#inferExpr(defaultValue.body, level + 1),
          );
          this.#unify(expected.result, body, defaultValue.span);
          this.#expressionTypes.set(defaultValue, expected);
        }
        continue;
      }
      if (item.kind === "Honor") {
        // By identity: this instance answers one declaration, which may be an
        // imported one this module reaches under an alias or through a module
        // namespace (§6.5's "a reference to its declaration").
        const declaration = this.#constraintsByIdentity.get(item.constraintIdentity);
        // By identity, like the seat above it (#727): a `derives` entry is a
        // reference to a declaration, and an importer's alias for one of the
        // four is one of the four. The *report* still names the word the source
        // wrote, which is the one the reader can see.
        if (item.derived && !DERIVABLE_IDENTITIES.has(item.constraintIdentity)) {
          this.#diagnostics.add({
            severity: "error",
            message: `\`${item.constraint}\` cannot be derived; only \`Eq\`, \`Ord\`, \`Show\`, and \`Hash\` have derivable forms`,
            primary: item.span,
          });
          continue;
        }
        // Constraints §4.5's carve-out (#344): a **privileged prelude companion
        // honoring at its own primitive** may hand-write `Hash`, because a
        // primitive has no declaration to hang `derives` on and the refusal's
        // own rewrite therefore names nothing writable. The
        // hash-agrees-with-`Eq` obligation transfers to that file, where both
        // instances sit side by side. Every user module keeps the refusal
        // verbatim: the carve-out follows compilation privilege, exactly as the
        // intrinsic door's gate does.
        //
        // The refusal itself is unchanged; what it *says* is Collections Part 2
        // §9's five-row law (#647), rendered by `#handWrittenHashRefusal` — the
        // seat joins #644's advice family, so the advice offered is the advice
        // the subject can actually take, and one of the five rows is silence.
        //
        // The gate reads the **identity** (#727). It used to read the name, on
        // the premise that a constraint written here has nothing to occlude it —
        // and that premise was not what the gate needed. Nothing occludes `Hash`;
        // an import *adds* a spelling rather than taking one, and it does so
        // through two channels, each of which walked straight past this refusal
        // and compiled a hand-written `Hash` with no diagnostic at all:
        //
        //     import { Hash as H } from "./Hash.hex"   →  honor H<P>
        //     import module M from "./Hash.hex"        →  honor M.Hash<P>
        //
        // The second needs no alias and leaves the word `Hash` untouched, which
        // is what makes "the spelling here is not `Hash`" the wrong question to
        // ask. Everything the renderer asks of the *subject* was already asked by
        // identity; now the constraint is too.
        if (
          !item.derived && item.constraintIdentity === HASH_IDENTITY &&
          !this.#companionsPrimitive(item.subject)
        ) {
          const message = this.#handWrittenHashRefusal(item);
          if (message !== undefined) {
            this.#diagnostics.add({
              severity: "error",
              message,
              primary: item.span,
            });
          }
          // Refused either way — silence is about the report, not about the
          // instance, which never joins the table. #651: the member bodies below
          // are therefore never inferred, and materialization must be told.
          this.#uninferredInstanceMembers.add(item);
          continue;
        }
        if (declaration === undefined && !item.derived) {
          if (this.#checkPreludeHonor(item, level)) continue;
          this.#diagnostics.add({
            severity: "error",
            ...this.#unknownConstraint(item.constraint),
            primary: item.span,
          });
          this.#uninferredInstanceMembers.add(item);
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
            this.#instanceComponents.set(
              item,
              this.#derivationComponents(actual, item.span).map((component) => ({
                key: component.key,
                requirement: this.#require(
                  item.constraint,
                  component.type,
                  component.span,
                  "operation",
                  undefined,
                  item.constraintIdentity,
                ),
              })),
            );
          }
          this.#instanceBaseConstraints.set(
            item,
            this.#instanceBaseRequirements(item, instanceSubject),
          );
          // Collections Part 2 §4.3, by identity at both ends (#727), and the
          // two ends are not the same kind of change. The **gate** is a repair:
          // it went live the moment the derivability gate above stopped refusing
          // `derives (H)` and `honor M.Hash<P> = derive` first, and a name-keyed
          // read of it lets a second spelling derive a hash beside a hand-written
          // `Eq`. The **lookup** is hardening only — `Eq` names `hex:Eq` in every
          // module, since an import may not bind a pre-registered word (`import
          // { Ord as Eq }` is refused), so `#instanceKeyFor("Eq", …)` could not
          // have been wrong. It reads the identity because the line beside it
          // does, and a reader should not have to re-derive which of the two is
          // load-bearing.
          if (item.constraintIdentity === HASH_IDENTITY) {
            const equality = this.#instances.get(
              this.#instanceKey(EQ_IDENTITY, instanceSubject),
            );
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
          this.#instanceBaseRequirements(item, instanceSubject),
        );
        const stored = this.#instanceImpliedTypes.get(item);
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
            impliedTypes.set(required.name, stored?.get(required.name) ?? ERROR);
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
        const checkMember = (member: Resolved.HonorMember): void => {
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
            return;
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
            return;
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
                  // A copy, not the live binder map: the annotation may name
                  // the instance's binders, but a name it introduces must not
                  // become an instance parameter.
                  new Map(this.#instanceTypeParameters.get(item) ?? []),
                  impliedTypes,
                ),
                expectedParameter,
                parameter.annotation.span,
              );
            }
          });
          // §4.3's last supplying seat, and the one Constraints §4.1 already
          // described in words: **a constraint member's body** is checked, not
          // inferred, its type fully determined by the declaration with the
          // subject substituted. The parameters have taken their expected types
          // above since members existed; the result component now supplies the
          // body the same way, so one mechanism serves both sentences.
          const body = this.#inferExpr(
            member.value.body,
            level + 1,
            expectedFunction.result,
          );
          this.#unify(expectedFunction.result, body, member.span);
          this.#expressionTypes.set(member.value, expectedFunction);
        };
        for (const member of item.members) {
          // A **derived** member (Constraints §4.7) is the module's `widens`
          // binding called at the member's own seats, and it waits for the end
          // of the module's items.
          //
          // What the wait is *for*, measured rather than assumed: a declaration
          // that fails §4.7's signature check has no restriction to derive, and
          // checking its member anyway reports the same fault a second time, at
          // the honor block, as a bare seat mismatch. The check runs after
          // `#checkWidensDeclarations` so a failed door derives nothing. (Left
          // in place, that cascade is visible on five refusal pins.)
          //
          // It also makes the pairing order-free — `honor` may stand above the
          // declaration it accounts for (Declarations Preamble §7.2), and by
          // the deadline every scheme this file seeds is seeded, so a derived
          // body can name a binding written below its block. That property is
          // pinned behaviourally in `gen-law-reach.test.ts`; it is not what
          // forces the deferral, and the note says so rather than claiming a
          // reason the code does not have.
          if (member.derived === true) {
            this.#derivedMembers.push({
              key: `${item.constraintIdentity} ${member.name}`,
              check: () => checkMember(member),
            });
            continue;
          }
          checkMember(member);
        }
        continue;
      }

      if (item.kind === "Var") {
        // *(#700.)* §4.3's supplying-seat list dropped its "annotated `var` and
        // every `:=` right-hand side" entry when the function-type ban landed
        // (Statements §6.1): the only lambda that seat could land is a
        // function-typed `var`'s, which no longer exists. The **numeric**
        // channel is untouched — it belongs to Numeric Literals §5.1's own list,
        // and it rides `#unifyExpected` below, not this one.
        const annotation = item.annotation;
        const inferredValueType = this.#inferExpr(item.value, level + 1);
        let valueType = inferredValueType;
        if (annotation !== undefined) {
          const annotationType = this.#inAnnotationPosition(annotation, () =>
            this.#annotationType(
              annotation,
              level + 1,
              new Map(),
              this.#annotationVariableScope ?? new Map(),
            ));
          this.#unifyExpected(
            annotationType,
            inferredValueType,
            item.value,
            annotation.span,
            true,
          );
          if (this.#hasNumericWidening(item.value)) valueType = annotationType;
        }
        // A `var` holds one value of one type for as long as it is in scope, so
        // its variables belong to the environment and must sit at the block's
        // own level. Functions §8.4 says a `var` never generalizes; this is the
        // other half of that sentence — nothing *else* may generalize it either.
        // Before item 7, an alias `let e = v` demoted these variables on the way
        // to refusing to quantify anything; now that expansive bindings can
        // quantify, the demotion has to happen where the `var` is bound, or the
        // alias would hand out a polymorphic view of a binding that can still be
        // assigned at one type.
        this.#lowerLevels(valueType, level);
        this.#schemes.set(item.binding.symbol, { variables: [], type: valueType });
        this.#mutableSymbols.add(item.binding.symbol);
        this.#refuseFunctionTypedVar(item, valueType);
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
        //
        // The seat is a field rather than a parameter because it is read only by
        // the refutability reports, which sit several recursive levels down and
        // would otherwise thread it through every pattern arm. Nothing inside a
        // `let` pattern can start another one, so the save is a formality kept
        // for the reader.
        const enclosingSeat = this.#patternSeatIsLambdaParameter;
        this.#patternSeatIsLambdaParameter = item.parameter === true;
        this.#inferPattern(
          item.pattern,
          valueType,
          level,
          this.#isValue(item.value),
          valueType,
        );
        // §5.1's gate, once, over the whole pattern — `let` and the lambda
        // parameter both arrive here (§6.3, §6.5), and both get §5.3's one
        // sentence. Run after the walk, because the walk is what settles the
        // types the matrix reads.
        this.#checkBindingPattern(item.pattern, valueType);
        this.#patternSeatIsLambdaParameter = enclosingSeat;
        continue;
      }

      if (item.kind === "ExprItem") {
        // §4.3's block-final forwarding, and only that: an item whose value is
        // discarded is not a value path and synthesizes as before. A right-hand
        // side's layout block is the one-item case of this rule.
        const expressionType = this.#inferExpr(
          item.expression,
          level,
          !moduleItems && index === items.length - 1 ? expected : undefined,
        );
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
    this.#linkedArrowPosition = enclosingPosition;
    this.#annotationVariableScope = enclosingVariableScope;

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

  /**
   * A written `<...>` binder list, entered as the rigid variables it declares
   * (Functions §4.1, §4.2).
   *
   * One routine for both positions the restriction admits: a lambda's own list
   * — the fused `fun`'s and the `let`'s — and *(#700)* a `fun` block head's,
   * whose variables are one rigid each **scoped over every member**. `owner` is
   * what §10's rigid-vs-rigid message later qualifies a side by, and the
   * variables are recorded against every member the owner covers so §7.4's fence
   * reaches the whole component.
   */
  /**
   * Files a declared type variable under the site that declared it, for §10's
   * rigid-vs-rigid message and §7.4's fence (#368, #700).
   *
   * Rigidity is independent of the binder (§4.2.1): a variable introduced by its
   * first appearance in a member's annotation is as declared as one a `<...>`
   * list names, and §7.4 refuses two of *those* meeting through a knot exactly
   * as it refuses two binders'. So both mints come here, and the owner is what
   * separates a member's own variable from the block head's.
   */
  #recordDeclaredHead(variable: Variable, owner: HeadOwner | undefined): void {
    if (owner === undefined) return;
    this.#declaredHeadOwners.set(variable.id, owner);
    const covered = owner.kind === "member" ? [owner.symbol] : owner.members;
    for (const symbol of covered) {
      const heads = this.#memberHeadVariables.get(symbol) ?? [];
      heads.push(variable);
      this.#memberHeadVariables.set(symbol, heads);
    }
  }

  #declareBinderVariables(
    parameters: readonly Resolved.TypeParameter[],
    level: number,
    into: Map<string, Variable>,
    owner: HeadOwner | undefined,
  ): void {
    for (const parameter of parameters) {
      const declaredConstraints = parameter.constraints.filter((constraint) =>
        this.#constraintNames.has(constraint) &&
        !this.#bearsProjection(constraint)
      );
      const variable = this.#fresh(
        level + 1,
        false,
        parameter.name,
        declaredConstraints,
      );
      into.set(parameter.name, variable);
      this.#recordDeclaredHead(variable, owner);
      for (const constraint of parameter.constraints) {
        if (!this.#constraintNames.has(constraint)) {
          this.#diagnostics.add({
            severity: "error",
            ...this.#unknownConstraint(constraint),
            primary: parameter.span,
          });
          continue;
        }
        if (this.#bearsProjection(constraint)) {
          this.#diagnostics.add({
            severity: "error",
            message: impliedTypeBinderMessage(constraint, this.#constraintIdentity(constraint)),
            primary: parameter.span,
          });
          continue;
        }
        this.#require(constraint, variable, parameter.span, "annotation");
      }
    }
  }

  /**
   * Types one `fun` block (Functions §7.3) — the fused spelling arriving as the
   * one-member block it is.
   *
   * The block bounds visibility, not typing: the monomorphic knot is still the
   * strongly-connected component of the references actually written, computed
   * *within* the block and typed dependencies-first (§7.4). Two independent
   * members therefore keep their own generality — a member outside the current
   * component is already generalized and instantiated fresh per use.
   *
   * Members are held on `#funGroups` while their bodies are checked, which is
   * what lets a dot call inside one recognize a sibling as its own block and
   * refuse it (Method Syntax §4.4). The component being checked is held on
   * `#knots` over the same span, for the two things §7.4 says about references
   * that resolve inside it: their evidence is the identity suffix, and two
   * declared heads cannot meet.
   *
   * *(#700.)* The head's binder list is declared **once, here**, and every
   * member's annotation scope inherits it — which is the whole of "sharing is
   * opt-in by placement": a member that writes `a` gets *the* block variable,
   * and a member that writes a spelling the head does not declare gets its own
   * rigid, minted inside that member's own lambda scope and shared with nobody.
   */
  #inferFunGroup(group: readonly Resolved.FunItem[], level: number): void {
    const head = group[0]?.block;
    const enclosingVariableScope = this.#annotationVariableScope;
    if (head?.typeParameters !== undefined) {
      const scope = new Map<string, Variable>(this.#annotationVariableScope);
      this.#declareBinderVariables(head.typeParameters, level, scope, {
        kind: "block",
        members: group.map((item) => item.binding.symbol),
        span: head.span,
      });
      this.#annotationVariableScope = scope;
    }
    try {
      this.#inferFunBlockMembers(group, level);
    } finally {
      this.#annotationVariableScope = enclosingVariableScope;
    }
  }

  #inferFunBlockMembers(group: readonly Resolved.FunItem[], level: number): void {
    const bySymbol = new Map(group.map((item) => [item.binding.symbol, item]));
    const members = new Set(bySymbol.keys());
    const references = new Map(
      group.map((item) => [item.binding.symbol, referencedSymbols(item.value)]),
    );
    const sourceIndex = new Map(group.map((item, index) => [item.binding.symbol, index]));
    const recursiveTypes = new Map<Resolved.SymbolId, Variable>();
    const components = stronglyConnectedComponents(
      group.map((item) => item.binding.symbol),
      (symbol) => [...(references.get(symbol) ?? [])].filter((referenced) => members.has(referenced)),
    );
    this.#funGroups.push(members);
    for (const component of components) {
      const ordered = [...component].sort(
        (a, b) => sourceIndex.get(a)! - sourceIndex.get(b)!,
      );
      for (const symbol of ordered) {
        const recursiveType = this.#fresh(level + 1, false);
        recursiveTypes.set(symbol, recursiveType);
        this.#schemes.set(symbol, { variables: [], type: recursiveType });
      }
      const knot: Knot = {
        members: ordered.map((symbol) => ({
          symbol,
          name: bySymbol.get(symbol)!.binding.name,
          exported: bySymbol.get(symbol)!.exported,
        })),
        host: undefined,
        references: [],
        refused: false,
      };
      this.#knots.push(knot);
      for (const symbol of ordered) {
        const item = bySymbol.get(symbol)!;
        const enclosingMember = this.#declaringMember;
        const enclosingAnnotationOwner = this.#annotationOwner;
        knot.host = symbol;
        this.#declaringMember = { symbol, name: item.binding.name };
        // The member owns every variable its annotations are the first to
        // write, binder or not (§7.3's member-scoped rule).
        this.#annotationOwner = {
          kind: "member",
          symbol,
          name: item.binding.name,
        };
        const value = this.#inferExpr(item.value, level + 1);
        this.#declaringMember = enclosingMember;
        this.#annotationOwner = enclosingAnnotationOwner;
        this.#unify(recursiveTypes.get(symbol)!, value, item.span);
      }
      knot.host = undefined;
      this.#knots.pop();
      // Every member's head exists only now, which is why §7.4's refusal
      // discharges its fence here rather than where it reported.
      if (knot.refused) this.#errorKnotHeads(knot);
      this.#pinUnreachableKnotEvidence(knot, recursiveTypes, level);
      for (const symbol of ordered) {
        this.#schemes.set(
          symbol,
          this.#generalize(recursiveTypes.get(symbol)!, level, true, undefined),
        );
      }
    }
    this.#funGroups.pop();
  }

  /**
   * §10's fence on the rigid-vs-concrete family: once §7.4's refusal has fired,
   * no head of the component may reach defaulting.
   *
   * A head no unification errors survives to the module deadline, where
   * defaulting binds it to `Int` and the rigid-vs-concrete message reports that
   * as a demand of a body with no `Int` in it. The pair that met is not the
   * whole set — at three headed members the first collision names two, and the
   * third is defaulted — nor even a subset the collision could reach: the third
   * member's head is not written until its own body is checked.
   *
   * Hence one call site, at the component's end, where every head exists — and
   * the timing is a decision, not an implementation convenience. Erroring the
   * heads where the collision reports costs a real diagnostic: a later member's
   * body can force the type a surviving head stands in, and *that* `String` is a
   * demand the body makes, which the fence is not for. The knot's refusal and
   * the annotation error are two repairs the author owes, and reporting them
   * together is what saves a compile.
   * `conformance/recursion-knot.test.ts`'s "a head errored by the refusal still
   * reports its own body's demand" fails if either of them is dropped.
   */
  /**
   * Statements §6.1's function-type ban, at the **declaration** (#700).
   *
   * Type-level, not a spelling ban: a lambda right-hand side is only the
   * obvious case, and `var f = identity(x => x)` walks past a spelling check.
   * What is read is the `var`'s own monotype — annotated or inferred — and only
   * its top level: functions inside data are data, so `var handlers = [f, g]`
   * is untouched.
   *
   * A monotype that is still an unsolved variable settles later, and is watched
   * for by `#pinnedVars`: the ban's other arm fires at the pinning use.
   */
  #refuseFunctionTypedVar(item: Resolved.VarItem, valueType: Mono): void {
    const resolved = this.#prune(valueType);
    if (resolved.kind === "Function") {
      this.#diagnostics.add({
        severity: "error",
        message: functionTypedVarMessage(item.binding.name),
        primary: item.binding.span,
      });
      return;
    }
    // Only a bare variable can *become* an arrow: every other shape has a head
    // already, and a `var` holds one value of one type for its whole scope.
    if (resolved.kind === "Variable") {
      this.#pinnedVars.set(resolved.id, item.binding.name);
    }
  }

  #errorKnotHeads(knot: Knot): void {
    for (const { symbol } of knot.members) {
      for (const head of this.#memberHeadVariables.get(symbol) ?? []) {
        head.instance = ERROR;
      }
    }
  }

  /**
   * Keeps the knot's evidence demand inside what the knot can supply, before the
   * component generalizes.
   *
   * §7.4's identity suffix is the caller's *own* dictionary parameters, so it
   * covers exactly the constrained variables caller and callee share. The knot
   * can also put a constrained variable in one member's type and nowhere in
   * another's — `outer(x, n)` comparing `x`, `inner(n)` calling `outer(0, …)` —
   * and there the sibling's reference demands evidence no call site of *that*
   * sibling could ever determine. Quantifying such a variable hands the caller a
   * dictionary parameter it does not have; the emitter has nothing to name and
   * the module dies with a missing-evidence report the author cannot act on.
   *
   * Demoting the variable to the enclosing level is the ordinary answer, not a
   * new one: it is the state a variable no signature mentions is already in, and
   * it lands on the same pinning-or-defaulting the deadline applies everywhere
   * else. The variable is shared, so demoting it removes it from every member's
   * scheme at once — which is right, because inside the knot every member holds
   * it at the same identity.
   */
  #pinUnreachableKnotEvidence(
    knot: Knot,
    recursiveTypes: ReadonlyMap<Resolved.SymbolId, Variable>,
    level: number,
  ): void {
    if (knot.references.length === 0) return;
    const quantifiable = new Map<Resolved.SymbolId, ReadonlySet<number>>();
    const own = (symbol: Resolved.SymbolId): ReadonlySet<number> => {
      const cached = quantifiable.get(symbol);
      if (cached !== undefined) return cached;
      const type = recursiveTypes.get(symbol);
      const ids = new Set(
        type === undefined
          ? []
          : this.#collectVariables(type)
              .filter((variable) => variable.level > level)
              .map(({ id }) => id),
      );
      quantifiable.set(symbol, ids);
      return ids;
    };
    for (const { host, target } of knot.references) {
      const supplied = own(host);
      const targetType = recursiveTypes.get(target);
      if (targetType === undefined) continue;
      for (const variable of this.#collectVariables(targetType)) {
        if (variable.level <= level) continue;
        if (variable.requirements.length === 0) continue;
        if (supplied.has(variable.id)) continue;
        variable.level = level;
      }
    }
  }

  /**
   * The subject's direct components, each with the key emission expands it
   * under (#278): a field name for a record, `Constructor.field` for a union
   * slot. The keys, not the positions, are what pair the checker's selection
   * with the emitter's walk — the derived `compare` and `show` bodies visit a
   * record's fields in *name* order while this list is in declaration order.
   */
  #derivationComponents(
    subject: UnionMono | NominalRecordMono,
    fallbackSpan: Source.Span,
  ): readonly { readonly key: string; readonly type: Mono; readonly span: Source.Span }[] {
    if (subject.kind === "NominalRecord") {
      const fields = this.#nominalRecordFields(subject);
      const declaration = this.#records.get(subject.record);
      return [...fields].map(([name, type]) => ({
        key: name,
        type,
        span: declaration?.fields.find((field) => field.name === name)?.span ??
          declaration?.span ?? fallbackSpan,
      }));
    }
    // Same standing as the record arm's `#nominalRecordFields` call above: a
    // derived body's components are the declaration's, and a union reached only
    // through an imported signature has no row here until it is asked for.
    this.#materializeReachedUnion(subject.union);
    const parameters = [...(this.#unionParameters.get(subject.union)?.values() ?? [])];
    const replacements = new Map(
      parameters.map((parameter, index) => [parameter.id, subject.arguments[index] ?? ERROR]),
    );
    const union = this.#unions.get(subject.union);
    return union?.constructors.flatMap((constructor) =>
      constructor.slots.map((slot) => ({
        key: `${constructor.binding.name}.${slot.field}`,
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

  /**
   * The wired-in signatures of the pre-registered constraints, for a compile
   * with **no prelude at all** — the pass-level unit harnesses, which assemble a
   * module by calling the passes directly. It is reached only where the honored
   * constraint has no declaration in view, which in a real compile means the
   * program named nothing (`#unknownConstraint` follows).
   *
   * Name-keyed on purpose, and #727 does not touch it: both second-spelling
   * channels — a renaming named import and `import module`'s qualifier — go
   * through importing the prelude module that declares the constraint, and in a
   * compile that reaches this arm there is no such module to import. The two
   * routes and this fallback are mutually exclusive by construction. The
   * identity would be the right key in any compile where a second spelling could
   * exist, and in none of those does this run. `constraints.ts`'s
   * `PRE_REGISTERED_CONSTRAINT_MEMBERS` is the resolver's half of the same
   * fallback, and it stays name-keyed for the same reason.
   */
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
      // The one heterogeneous member in the table (#541): the exponent is an
      // `Int` seat, not a second subject.
      members.set("pow", { parameters: [subject, primitive("Int")], result: subject });
    } else if (item.constraint === "Integral") {
      for (const name of ["div", "mod", "quot", "rem", "gcd"] as const) {
        members.set(name, binary);
      }
    } else {
      return false;
    }

    this.#instanceBaseConstraints.set(
      item,
      this.#instanceBaseRequirements(item, subject),
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

  /**
   * Validates the implication DAG before evidence selection begins.
   *
   * Over this module's **own** declarations, and deliberately no wider. An
   * imported declaration was checked where it was written; re-checking it here
   * would report the home module's spec violations once per importer, at spans
   * in a file the reader did not open — and the cycle report would name a
   * declaration this module may not even be able to spell.
   */
  #checkBaseConstraintGraph(): void {
    for (const declaration of this.#localConstraints.values()) {
      for (const baseConstraint of declaration.baseConstraints) {
        if (!this.#constraintNames.has(baseConstraint)) {
          this.#diagnostics.add({
            severity: "error",
            message: `unknown base constraint \`${baseConstraint}\``,
            primary: declaration.span,
          });
        }
        if (this.#bearsProjection(baseConstraint)) {
          this.#diagnostics.add({
            severity: "error",
            message: impliedTypeBinderMessage(baseConstraint, this.#constraintIdentity(baseConstraint)),
            primary: declaration.span,
          });
        }
      }
      this.#checkBaseConstraintList(declaration);
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
          primary: this.#localConstraints.get(name)!.span,
        });
        return;
      }
      state.set(name, "visiting");
      const declaration = this.#localConstraints.get(name);
      for (const baseConstraint of declaration?.baseConstraints ?? []) {
        if (this.#localConstraints.has(baseConstraint)) {
          visit(baseConstraint, [...path, name]);
        }
      }
      state.set(name, "visited");
    };
    for (const name of this.#localConstraints.keys()) visit(name, []);
  }

  /**
   * Constraints §6.2's rule about one declaration's base **list** — that it
   * names each declaration once — asked at the module that declares the
   * extending constraint, which is the only module that can repair it, and the
   * only one whose spans belong in the report.
   *
   * Local coverage is the whole requirement, not a limitation: an imported
   * extender was refused where it was written. What local coverage has to see
   * is every *spelling* an author can reach a declaration by — a bare import, an
   * alias, a module-qualified name — and it does, because the list is read
   * through `#baseConstraintSlots`, which is identity-keyed and so blind to
   * which word stood in the source.
   */
  #checkBaseConstraintList(declaration: Resolved.ConstraintItem): void {
    const bases = this.#baseConstraintSlots(declaration.identity);
    // §6.2: a base list names each declaration **once**. Keyed by identity, so
    // `(Weigh, Heft)` over an alias, `(Weigh, L.Weigh)` over the qualified form
    // and the bare `(Show, Show)` are one refusal. A duplicate adds nothing a
    // single entry does not, and the repair is deleting one entry of the
    // author's own list — unlike the distinct-identity meeting below it, whose
    // colliding spellings are foreign and cannot be renamed, and which the slot
    // contest disambiguates instead.
    const firstByIdentity = new Map<string, number>();
    bases.forEach((base, index) => {
      // An entry whose spelling resolves to no declaration is not half of a
      // duplicate: the refusal is an identity claim, and it needs an identity
      // to be about. `<a: (Bogus, Bogus)>` is the unknown-base row, once per
      // entry, and nothing more — the two would otherwise agree on the identity
      // the *name* mints and be reported as naming one declaration, which is
      // both untrue and unrepairable in the terms the message offers.
      //
      // Per entry, deliberately, and asked with the same predicate the
      // unknown-base row above asks with, so the two rows cannot disagree about
      // what resolved: a resolved pair standing beside an unrelated unknown
      // third entry is refused exactly as it would be without it.
      if (!this.#constraintNames.has(declaration.baseConstraints[index]!)) return;
      const first = firstByIdentity.get(base.identity);
      if (first === undefined) {
        firstByIdentity.set(base.identity, index);
        return;
      }
      this.#diagnostics.add({
        severity: "error",
        message: `\`${declaration.baseConstraints[first]}\` and ` +
          `\`${declaration.baseConstraints[index]}\` both name the constraint ` +
          `declared \`${base.name}\`${this.#baseConstraintHomeClause(base.identity)}; ` +
          "remove one",
        primary: declaration.span,
      });
    });
    // §6.2's other rule about this list — that no member may take a minted slot
    // — is *not* checked, and has no check to make: a slot is the base
    // declaration's name verbatim, so it is uppercase-start, and a function
    // member's name is not (§2). The two spelling spaces are disjoint by start
    // class. An implied type member is uppercase-start but claims no slot, so it
    // enters no contest either.
  }

  /**
   * ` in \`./lib.hex\`` for the duplicate-base refusal — the home module of the
   * declaration both spellings named, by project-relative path.
   *
   * Empty where there is no path a reader could open: a pre-registered
   * constraint's declaration is the prelude's, which §7.6 withholds for the same
   * reason (`#constraintHome`), and a compilation with no paths at all — a bare
   * `check` in a unit harness — has nothing to relativize against. The sentence
   * reads correctly without the clause; both spellings and the declared name are
   * already in it.
   */
  #baseConstraintHomeClause(identity: string): string {
    if (isPreRegisteredIdentity(identity)) return "";
    const home = this.#constraintsByIdentity.get(identity)?.declaringPath;
    if (home === undefined || this.#modulePath === undefined) return "";
    return ` in \`${relativeFilePath(this.#modulePath, home)}\``;
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

  /**
   * Gives compiler-known persistent collection operations their ordinary function
   * types — **`Node`'s alone** since the Map/Set arc closed (#373).
   *
   * `Vector`'s rows went at its intrinsic-door milestone, `Map`'s at the Map step
   * (#370) and `Set`'s at the Set step: `stdlib/Vector.hex`, `stdlib/Map.hex` and
   * `stdlib/Set.hex` declare those surfaces themselves, so each declaration owns
   * its type (`spec/intrinsics.md` §4.2, §9.2). The `Set(a)` *type* is untouched
   * by that — it remains a checker `Mono` with all its per-kind arms, and only
   * the transitional typing of `Set.` operations died here.
   *
   * What is left is the `Node` trie intrinsic, which by §3.3 never gets a module
   * of its own and is the family's terminus (#223). `requirements` is threaded
   * for the checker's uniform plumbing and nothing pushes onto it: all four
   * operations are unconstrained.
   */
  #collectionOperationType(
    collection: Resolved.CollectionOperationExpr["collection"],
    operation: string,
    level: number,
    span: Source.Span,
    _requirements: Requirement[],
  ): Mono {
    // The hidden fixed-32 trie node: 32 slots of `element`, addressed 0..31.
    // `set`/`copy` are immutable (return a fresh node); see the design note §4.
    const element = this.#fresh(level, false);
    const node: NodeMono = { kind: "Node", element };
    if (operation === "empty") return { kind: "Function", parameters: [], result: node };
    if (operation === "get") return { kind: "Function", parameters: [node, primitive("Int")], result: element };
    if (operation === "set") return { kind: "Function", parameters: [node, primitive("Int"), element], result: node };
    if (operation === "copy") return { kind: "Function", parameters: [node], result: node };
    return this.#unsupported(span, `the companion of \`${collection}\` has no core operation \`${operation}\``);
  }

  /**
   * Functions §4.3 *(#513, #517)*: `expected` is the type a **seat** wrote
   * around this expression, carried inward through the forwarding forms and
   * landing at exactly two sites — a **lambda literal**, where it fixes the
   * parameters before the body is inferred, and an **arithmetic operation**,
   * where a concrete type carrying the operator's instance is the operation's
   * home (Numeric Literals §5.1's lift). **One boundary at operations, none
   * elsewhere**: away from those two sites the expectation is inert — no
   * unification, no conversion, no diagnostic, and no widening target — because
   * the seat's own final check remains the typing authority.
   */
  #inferExpr(expression: Resolved.Expr, level: number, expected?: Mono): Mono {
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
      case "Name":
        const requirements: Requirement[] = [];
        type = this.#instantiate(
          this.#scheme(expression.symbol),
          level,
          requirements,
          expression.span,
          // Modules §5.3: `Rat.add` is the member **at `Rat`**, not the
          // polymorphic export the resolver found it through. Pinning the
          // subject is what makes that sentence true of the type as well as of
          // the reader's expectation.
          expression.instanceSubject === undefined
            ? undefined
            : this.#annotationType(
                expression.instanceSubject.annotation,
                level,
                new Map(),
                new Map(
                  expression.instanceSubject.typeParameters.map(({ name }) =>
                    [name, this.#fresh(level, false)] as const
                  ),
                ),
              ),
        );
        this.#nameRequirements.set(expression, requirements);
        // Functions §7.4: inside the knot the scheme is a monotype, so the copy
        // above collected nothing. What the reference owes is settled once the
        // component generalizes; `#knotEvidence` reads it back there.
        const knot = this.#knots.find((frame) =>
          frame.members.some(({ symbol }) => symbol === expression.symbol)
        );
        if (knot !== undefined) {
          this.#knotReferences.set(expression, expression.symbol);
          if (knot.host !== undefined) {
            knot.references.push({ host: knot.host, target: expression.symbol });
          }
        }
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
        // §4.3's first forwarding form: grouping parentheses return their
        // subexpression's value, so they hand on whatever expectation they were
        // given (§3.1).
        type = this.#inferExpr(expression.expression, level, expected);
        break;
      case "Ascription": {
        // Ascription introduces zero new semantics (§1): this is the annotated
        // binding's own sequence — infer, elaborate, unify — with the written
        // type elaborated in the *declaration's* annotation-variable scope, so a
        // name written here is the same variable the signature's is (§3.1).
        //
        // §3.1 defers the exact chaining across *nested* declarations, and this
        // invents nothing: the scope is whatever the enclosing definition
        // already had, so an ascription reaches a name exactly as a body-local
        // `let x: a` annotation has always reached it. Consequences, surfaced
        // rather than ruled — a fresh name first written inside an inner lambda
        // joins that lambda's map (its copy of the enclosing one) and does not
        // escape outward, and an inner `<a: C>` binder shadows by overwriting
        // its copy. Both are the pre-existing behaviour of the same map.
        //
        // *(#513.)* An ascription is a **supplying seat** (Ascription §3): the
        // written face reaches a lambda inside it before the body is inferred.
        // Ordering only — the unification performed is the one this section
        // already required, and the face is elaborated once, early only where an
        // expectation can land. An ascription is a seat, not a forwarding form:
        // it establishes its own expectation and passes no enclosing one on.
        const enclosingAscribedType = this.#ascribedTypeSpan;
        let suppliedFace: Mono | undefined;
        if (expectationLands(expression.expression)) {
          this.#ascribedTypeSpan = expression.annotation.span;
          suppliedFace = this.#annotationType(
            expression.annotation,
            level,
            new Map(),
            this.#annotationVariableScope ?? new Map(),
          );
          this.#ascribedTypeSpan = enclosingAscribedType;
        }
        const inferred = this.#inferExpr(expression.expression, level, suppliedFace);
        this.#ascribedTypeSpan = expression.annotation.span;
        // No signature scope is opened or cleared here, which is §2.2.2 ratified
        // rather than implemented: an ascription is a *local type position*, so
        // a `->?` written in it names the enclosing signature's variable —
        // whatever `#signatureFace` already holds — and is legal exactly where
        // that signature admits one. Outside every signature the face is absent
        // and the arrow takes §4.4's no-signature clause.
        const annotationType = suppliedFace ?? this.#annotationType(
          expression.annotation,
          level,
          new Map(),
          this.#annotationVariableScope ?? new Map(),
        );
        this.#ascribedTypeSpan = enclosingAscribedType;
        this.#unifyExpected(
          annotationType,
          inferred,
          expression.expression,
          expression.annotation.span,
          true,
        );
        // The widened form is the ascribed one, exactly as at an annotated
        // binding: `(1 : Float)` is the `Float` the writer claimed.
        type = this.#hasNumericWidening(expression.expression) ? annotationType : inferred;
        break;
      }
      case "Block":
        // A block's **final expression** is its value, so it inherits the
        // expectation; every earlier item is checked as it always was.
        type = this.#inferItems(expression.items, level, false, expected);
        break;
      case "Lambda": {
        // #355: one signature, one effect variable, all occurrences. A lambda
        // with an inlet of its own — a `->?` in a parameter type of any arrow
        // on its application spine, its return annotation's included (#408) —
        // opens a fresh signature scope and *is* that variable: its outer arrow
        // and its callbacks' arrows are the same colour, which is what makes
        // `fold` polymorphic rather than merely tolerant. A lambda with no inlet
        // of its own keeps the enclosing scope (nothing in it can read the
        // variable anyway) and takes a fresh colour of its own, which the body
        // then decides.
        const writtenOwn = this.#pendingOwnEffect;
        this.#pendingOwnEffect = undefined;
        // A `fun` item's value *is* this lambda, so the pending attribution is
        // this head's and no nested lambda's; taking it here is what scopes it.
        const declaringMember = this.#declaringMember;
        this.#declaringMember = undefined;
        // A lambda is a signature, wherever it stands: a `->?` refused inside
        // one is refused for want of an *inlet*, not for want of a signature,
        // and §4.4's clause has to say so even when the lambda sits in a
        // module-level binding whose own position is `"no-signature"`.
        const enclosingPosition = this.#linkedArrowPosition;
        this.#linkedArrowPosition = "signature";
        const ownLinked = signatureInlet(
          expression.parameters.map((parameter) => parameter.annotation),
          expression.returnAnnotation,
        );
        // A lambda whose colour a binding annotation already wrote *is* that
        // signature — `let f: (Tx ->? a) ->! a = (run: Tx ->? a): a => …` writes
        // one signature twice, and opening a second scope here would give the
        // same defect two reports and the same `->?` two variables.
        const enclosingSignature = this.#openSignature(
          writtenOwn !== undefined ? "inherit" : ownLinked ? "open" : "clear",
          level + 1,
          expression.span,
        );
        const inheritedInlet = this.#pendingInlet;
        this.#pendingInlet = false;
        const enclosingFrame = this.#effectFrames.at(-1);
        const effectFrame: EffectFrame = {
          // Never the signature's variable outright: a function whose body
          // performs no call at that colour is *pure*, however many `->?`s its
          // parameters wear. Effects §3.3's `compose` is exactly that shape —
          // two impure functions move through, a closure comes out, the world
          // untouched — and taking the signature's variable here would make
          // its call site shout. Absorption identifies the two when the body
          // really does forward, which is how `fold` becomes polymorphic.
          own: writtenOwn ?? this.#fresh(level + 1, false),
          inlet: ownLinked || inheritedInlet || enclosingFrame?.inlet === true,
          enclosing: enclosingFrame,
          absorbed: [],
          sourced: false,
        };
        this.#effectFrames.push(effectFrame);
        this.#frameByLambda.set(expression, effectFrame);
        const annotationTails = new Map<string, Variable>();
        // Inherit the enclosing definition's type variables so a nested lambda's
        // annotations may name them (lexical scoping); its own `<...>` binders below
        // shadow by overwriting.
        const annotationVariables = new Map<string, Variable>(this.#annotationVariableScope);
        this.#declareBinderVariables(
          expression.typeParameters ?? [],
          level,
          annotationVariables,
          declaringMember === undefined
            ? undefined
            : { kind: "member", ...declaringMember },
        );
        // **The landing** (§4.3). An expectation does nothing until it reaches a
        // lambda literal — a match function included, being a lambda by desugar
        // (Pattern Matching §6.7). It lands only if it is a function type of
        // *this* lambda's arity; anything else — wrong arity, a non-function, a
        // type still undetermined at the seat — declines **silently**, and
        // whatever is wrong surfaces as the seat's own existing diagnostic.
        const supplied = expected === undefined ? undefined : this.#prune(expected);
        const landing = supplied?.kind === "Function" &&
            supplied.parameters.length === expression.parameters.length
          ? supplied
          : undefined;
        const parameters = expression.parameters.map((parameter, index) => {
          const component = landing?.parameters[index];
          // An **unannotated** parameter *takes* the expected component — the
          // very type the seat's final unification would have imposed, arriving
          // early. Propagation adds no rigidity and removes none: a component
          // that is a declared variable arrives as the rigid variable it already
          // is, and one that is an ordinary inferred type lands as one.
          const parameterType = parameter.annotation === undefined
            ? (component ?? this.#fresh(level + 1, false))
            : this.#annotationType(
                parameter.annotation,
                level + 1,
                annotationTails,
                annotationVariables,
              );
          // An **annotated** parameter keeps its annotation as the contract
          // (§4.1, unchanged) and unifies with the component. A failure here is
          // the seat's ordinary mismatch — the same unification the seat's final
          // check would have failed — in the seat's own diagnostic family.
          if (parameter.annotation !== undefined && component !== undefined) {
            this.#unify(parameterType, component, parameter.span);
          }
          this.#schemes.set(parameter.symbol, {
            variables: [],
            type: parameterType,
          });
          // Pattern Matching §6.1's rider keys on this: a scrutinee that is a
          // lambda parameter still undetermined at dispatch is the program no
          // seat determined, and the constraint-operations advice points nowhere.
          this.#lambdaParameters.add(parameter.symbol);
          return parameterType;
        });
        const savedVariableScope = this.#annotationVariableScope;
        this.#annotationVariableScope = annotationVariables;
        // A **written** return annotation is this right-hand side's own written
        // face (§4.1), so it supplies the body ahead of inference exactly as a
        // binding annotation supplies its value — elaborated early only where an
        // expectation can land, so every other program keeps its elaboration
        // order to the letter. The expectation's own result component supplies
        // otherwise. Neither is *unified* with the body here; that stays the
        // seat's final check. What the body's expectation does reach is §5.1's
        // lift at an arithmetic body, which is why the landing pair agrees:
        // `let g: (Int) -> Float = x => x + x` runs its addition at `Float`,
        // and `let g = (x: Int): Float => x + x` emits the same JavaScript.
        let returnAnnotationType: Mono | undefined;
        if (
          expression.returnAnnotation !== undefined && expectationLands(expression.body)
        ) {
          returnAnnotationType = this.#annotationType(
            expression.returnAnnotation,
            level + 1,
            annotationTails,
            annotationVariables,
          );
        }
        const inferredResult = this.#inferExpr(
          expression.body,
          level + 1,
          returnAnnotationType ?? landing?.result,
        );
        this.#annotationVariableScope = savedVariableScope;
        let result = inferredResult;
        if (expression.returnAnnotation !== undefined) {
          const annotationType = returnAnnotationType ?? this.#annotationType(
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
          // The second seat where the published node is the value's rather
          // than the annotation's (§14.3): the body's type is what stands here,
          // and a `B.Row` a body reached for is not this signature's spelling.
          result = this.#hasNumericWidening(expression.body)
            ? annotationType
            : this.#applyWrittenQualifiers(annotationType, inferredResult);
        }
        this.#effectFrames.pop();
        // Settled here rather than at the end of the module: a function's
        // colour has to be decided *before* it is generalized, or its callers
        // instantiate a fresh unsolved variable and every pure call in the
        // corpus reads as a conduit. Bodies close innermost-first, and a
        // declaration closes before anything that can call it, so a callee's
        // colour is always known by the time a caller absorbs it.
        this.#settleFrame(effectFrame);
        this.#closeSignature(enclosingSignature);
        this.#linkedArrowPosition = enclosingPosition;
        type = {
          kind: "Function",
          parameters,
          result,
          effect: effectFrame.own,
        };
        break;
      }
      case "If": {
        const condition = this.#inferExpr(expression.condition, level);
        this.#unify(condition, this.#boolType(expression.condition.span), expression.condition.span);
        // §4.3: **both** branches forward — each returns the construct's value.
        // The condition does not; it is an operand, and synthesizes.
        const consequence = this.#inferExpr(expression.consequence, level, expected);
        const alternative = this.#inferExpr(expression.alternative, level, expected);
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
        // The arms below are the **erasure of Collections Part 5 §4's provided
        // rows, not a mechanism beside them** (#353, ruling 2). Each row is a
        // real coherence slot — registered by `#seedProvidedIterableRows`, and
        // what `toSeq(xs)` and `Vector.toSeq(xs)` both discharge against — and
        // reading the element type straight off the constructor here computes
        // exactly what looking the row up and substituting would: `Vector(a)`
        // implies `Item = a`, `Map(k, v)` implies `(k, v)`, `String` implies a
        // one-codepoint `String`. The shortcut is licensed by the binder ban
        // (Part 2 §7.2), which makes every `for..in` head monomorphic in its
        // outer constructor, so static resolution is total (§9.1) and the
        // lookup could never answer differently. A user nominal has no arm and
        // falls to the constraint path below, which is the same table's public
        // door.
        //
        // `for x in` over a `Seq` stays compiler-owned in *emission* (ruling
        // R3): the emitter's constant-stack `next` loop, not a dictionary call.
        // The `Seq` row exists all the same — it is the identity, and `toSeq`
        // at a sequence resolves through it — but the loop never asks for it.
        const sequenceElement = this.#asSequence(actual);
        if (actual.kind === "Range") {
          element = primitive("Int");
        } else if (sequenceElement !== undefined) {
          element = sequenceElement;
        } else if (
          actual.kind === "Vector" || actual.kind === "Set" || actual.kind === "Array" ||
          actual.kind === "JsSet"
        ) {
          element = actual.element;
        } else if (actual.kind === "Map" || actual.kind === "JsMap") {
          // `JsMap(k, v)` yields `(k, v)` exactly as the persistent `Map` does
          // (FFI Part 10 §6.1), and needs no adaptation to: a native `Map`'s
          // entries *are* two-element arrays, which is the tuple representation
          // (Part 10 §6.3).
          element = { kind: "Tuple", elements: [actual.key, actual.value] };
        } else if (
          actual.kind === "Constructor" && actual.name === "String"
        ) {
          element = primitive("String");
        } else if (actual.kind === "Variable" && actual.rigidName !== undefined) {
          // Collections Part 5 §3.2's split. A *declared* type variable and an
          // unsolved inference variable both stop step 2 of §3.1 — the outer
          // constructor is unknown — but they stop it for opposite reasons, and
          // the one message they used to share was a false trail for this half:
          // an annotation fixes an inference variable and cannot fix a generic
          // parameter, which is generic on purpose. The binder ban (Part 2 §9)
          // is the actual fact, surfacing here at a use site, so the message is
          // that ban's hint verbatim plus the one thing the user can do about
          // it — take the sequence itself.
          const iterable = expression.iterable;
          this.#diagnostics.add({
            severity: "error",
            message: `${
              // The spec spells the subject as the head's source name; a head
              // that is not a bare reference has no name to spell, so it gets
              // the neutral subject rather than a manufactured one.
              iterable.kind === "Name" ? `\`${iterable.text}\`` : "this value"
            } has the generic type \`${actual.rigidName}\`, and \`Iterable\` cannot constrain a type variable in v1; take a \`Seq(a)\` parameter instead`,
            primary: iterable.span,
          });
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
            // Not `"operation"`: a loop head that finds no instance gets §3.3's
            // two-legal-homes report, and only a loop head does. See
            // `Requirement.origin`.
            "iteration",
            new Map([["Item", element]]),
          );
          if (!requirement.reported) this.#iterations.set(expression, requirement);
        }
        this.#inferMatchPattern(expression.pattern, element, level);
        // §5.3: one sentence across all three gated positions, and this is one
        // of them. The loop's own wording is retired with the rest of the
        // per-form family — the judgment was never per-position, and neither is
        // the report.
        this.#checkBindingPattern(expression.pattern, element);
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
        for (const arm of expression.arms) {
          this.#inferMatchPattern(arm.pattern, scrutinee, level);
          if (arm.guard !== undefined) {
            const guard = this.#inferExpr(arm.guard, level);
            this.#unify(guard, this.#boolType(arm.guard.span), arm.guard.span);
          }
          // §4.3: every arm body forwards the expectation — an arm body is one
          // of the construct's value paths.
          this.#unify(result, this.#inferExpr(arm.body, level, expected), arm.body.span);
        }
        // The match catch clause (Exceptions §5.4): its arms are `try`'s arms in
        // a second seat, so they carry §5.3 whole and their bodies join the one
        // result type. Reachability is per-section — the loop above has already
        // finished, and the two sets never compete for one evaluation — and the
        // data arms' exhaustiveness demand below is untouched by the clause.
        if (expression.catchArms !== undefined) {
          this.#checkCatchArms(expression.catchArms, result, level, expected);
        }
        const actual = this.#prune(scrutinee);
        // §7's judgments come off one matrix. Reachability runs wherever the
        // arms were walked — every domain the dispatch admits below, and the
        // ones it refuses as well: a dead arm is a dead arm whatever the scrutinee
        // turned out to be, so a `match` on `Exn` or on a function type reports
        // its refusal *and* its unreachable arms, exactly as it did before this
        // seat was rewritten.
        //
        // The one exclusion is a scrutinee whose type is an unresolved variable
        // or an error, and it is a property of the matrix rather than a policy
        // about refusals: such a column knows nothing, so every pattern there
        // reads as a wildcard (`#coverageColumn`) and every arm after the first
        // would be reported dead. Suppressing the judgment is the only way not
        // to invent one.
        if (actual.kind !== "Variable" && actual.kind !== "Error") {
          this.#checkArmReachability(expression.arms, actual, MATCH_ARM_REPORTS);
        }
        if (
          actual.kind === "Union" || actual.kind === "NominalRecord" ||
          actual.kind === "Tuple" || actual.kind === "Record" ||
          actual.kind === "Vector" ||
          (actual.kind === "Constructor" &&
            (actual.name === "Int" || actual.name === "String" ||
              actual.name === "Float"))
        ) {
          // One report for every closed and every infinite domain alike. The
          // union's bare constructor listing, the nominal record's type name,
          // and the structural "needs a catch-all" demand were three renderings
          // of one judgment; §7.3 has one, and it is a witness pattern.
          //
          // The infinite domains (`Int`, `String`, `Float` — the last since
          // #513) join through the same door: their columns carry no signature,
          // so no set of literals ever completes them and the witness is `_`,
          // which is §7.1's "a catch-all is required" said in witnesses.
          //
          // The vector joins it too (#600). Its lengths *are* a signature
          // (Collections Part 3 §3.3, `#vectorColumn`), so the length-only
          // judgment that used to sit in a branch of its own — which never
          // looked at an element sub-pattern, and blessed `[True, ...rest]` +
          // `[]` over `Vector(Bool)` as exhaustive — is gone, and the witness
          // here is a whole vector value rather than a bare length.
          //
          // #147 deleted the `Bool` branch that stood here. `Bool` is a union,
          // so it reaches this path like every other union.
          if (actual.kind === "Union") this.#matchUnions.set(expression, actual.union);
          this.#reportMissingCases(expression.arms, actual, expression.span);
        } else if (
          actual.kind === "Constructor" &&
          actual.name === "Exn"
        ) {
          this.#diagnostics.add({
            severity: "error",
            message: "match requires a closed type; exceptions are inspected with `try`/`catch`",
            primary: expression.scrutinee.span,
          });
        } else {
          type = this.#unsupported(
            expression.scrutinee.span,
            actual.kind === "Variable"
              ? this.#abstractScrutineeRefusal(expression.scrutinee, actual)
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
        // §4.3: the `try` body block is the construct's value path, and every
        // catch arm body is a value path too — both forward.
        const result = this.#inferExpr(expression.body, level, expected);
        this.#checkCatchArms(expression.arms, result, level, expected);
        type = result;
        break;
      }
      case "Call": {
        // The frame is captured here, where the call was written. A dot call
        // may be elaborated much later, from a goal settled at a generalisation
        // boundary, and the frame stack then describes somewhere else.
        this.#callFrames.set(expression, this.#effectFrames.at(-1));
        if (expression.callee.kind === "Access") {
          const receiver = this.#inferExpr(expression.callee.receiver, level);
          const dispatched = this.#dispatchDotCall(
            expression,
            expression.callee,
            receiver,
            level,
          );
          if (dispatched !== undefined) {
            type = dispatched;
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
              message: `\`${expression.callee.text}\` is a value, not a function; ` +
                "write it without `()`",
              primary: expression.span,
            });
            type = ERROR;
            break;
          }
        }
        // §4.3's normative elaboration schedule *(#517)*. An application
        // elaborates its **callee first unless the callee is a lambda literal**,
        // then non-lambda arguments in source order, then lambda-literal
        // arguments in source order. Where the callee's type is a function of
        // this call's arity, its parameter types supply the arguments pointwise;
        // constructor applications included, a constructor being a function with
        // a known type. A callee whose type is still an undetermined variable
        // supplies nothing, and the arguments synthesize exactly as before.
        const arguments_: Mono[] = expression.arguments.map(() => ERROR);
        const deferredLambdas = new Set(
          expression.arguments.flatMap((argument, index) =>
            defersAsLambda(argument) ? [index] : []
          ),
        );
        const calleeIsLambda = defersAsLambda(expression.callee);
        if (calleeIsLambda) {
          // **The pipe seat** (§4.3, Operators §8). `value |> match …` rewrites
          // to `(match …)(value)` before inference, so the seat that supplies a
          // pipe stage's lambda *is* this application: the deferred class in
          // callee position, one schedule serving both. The arguments elaborate
          // first — reading no expectation, there being no callee type yet —
          // and the callee then lands the function type they build, pointwise,
          // over a fresh undetermined result. The landing rules govern from
          // there: an arity mismatch declines silently and the seat's ordinary
          // diagnostics stand.
          //
          // The schedule is **one ordered list**, not two positions with two
          // rules: non-lambda arguments, then lambda-literal arguments, then
          // the lambda-literal callee. A lambda *argument* of a lambda-callee
          // application defers exactly as it would anywhere else, so
          // `((cb, v) => …)(x => f(p), p + one)` types `p` from `p + one`
          // first — the same verdict its argument-swapped mirror reaches.
          for (const [index, argument] of expression.arguments.entries()) {
            if (deferredLambdas.has(index)) continue;
            arguments_[index] = this.#inferExpr(argument, level);
          }
          for (const index of deferredLambdas) {
            arguments_[index] = this.#inferExpr(expression.arguments[index]!, level);
          }
        }
        const callee = calleeIsLambda
          ? this.#inferExpr(expression.callee, level, {
            kind: "Function",
            parameters: [...arguments_],
            result: this.#fresh(level, false),
          })
          : this.#inferExpr(expression.callee, level);
        const calleeParameters = (() => {
          const known = this.#prune(callee);
          return known.kind === "Function" &&
              known.parameters.length === expression.arguments.length
            ? known.parameters
            : undefined;
        })();
        const pass = calleeParameters === undefined ? undefined : this.#argumentPass(
          calleeParameters,
          arguments_,
          expression.arguments,
          expression.span,
        );
        if (!calleeIsLambda) {
          for (const [index, argument] of expression.arguments.entries()) {
            if (deferredLambdas.has(index)) continue;
            arguments_[index] = this.#inferExpr(argument, level, calleeParameters?.[index]);
          }
          if (deferredLambdas.size > 0) {
            // An expectation has to *be* something by the time it is read, so
            // the whole first pass is checked before the second elaborates: a
            // callback anywhere in the list — ahead of its subject included —
            // reads its expectation off a resolved instantiation.
            pass?.establishFirstPass(deferredLambdas);
            for (const index of deferredLambdas) {
              arguments_[index] = this.#inferExpr(
                expression.arguments[index]!,
                level,
                calleeParameters?.[index],
              );
            }
          }
        }
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
          // The same sweep either way: `pass` is the one that already checked a
          // prefix, and exists exactly when the callee was a function of this
          // arity before the arguments were elaborated. A callee that only
          // *became* one during them checked no prefix and starts from zero.
          if (pass !== undefined && knownCallee.parameters === calleeParameters) {
            pass.finish();
          } else {
            this.#checkCallArguments(
              knownCallee.parameters,
              arguments_,
              expression.arguments,
              expression.span,
            );
          }
          // Ruling 6, the outermost-arrow sentence: the colour reported is the
          // one arrow *this* application applies. Arrows nested in the
          // parameter or result types are cargo, and are never consulted here —
          // which is why `compose(save, audit)` is a bare call.
          this.#registerCall(expression, knownCallee.effect ?? PURE, calleeLabel(expression));
          type = knownCallee.result;
        } else if (knownCallee.kind !== "Variable" && knownCallee.kind !== "Error") {
          // The callee is known, and it is not a function. Unification with a
          // demanded arrow is guaranteed to fail here, and the mismatch it
          // reports is the wrong sentence twice over (#385): its subject is a
          // type disagreement rather than "this is not a function", and the
          // arrow it prints carries a colour — `->?` — that nothing in the
          // program asked for. Report the sentence directly instead, and
          // register no mark obligation: a non-call owes no mark, and minting
          // one buys a second report about an arrow that was never there.
          //
          // The branch below is a different thing wearing the same clothes — a
          // callee not yet *known* to be a function, mutual recursion inside an
          // SCC included — and keeps the unify. A callee that already failed
          // keeps falling through it silently.
          //
          // A *nullary union constructor* takes Unions §2.2's own sentence
          // instead. The writer named the value; a type display would print the
          // instantiation's fresh variable (`Option(?433)`) — noise about a
          // value the writer already knows. `#constructorUnions` alone decides
          // membership: it holds every union constructor whose union this
          // module can see, imported ones included (`module.unions` carries
          // them), and never an exception constructor — which shares the
          // resolver's `"constructor"` symbol kind but not the map. A *local*
          // nullary exception never reaches this arm at all (the `#exceptions`
          // short-circuit above), and an imported one arrives typed `Exn` and
          // keeps the generic sentence — both pinned in conformance.
          //
          // The fixit is offered only where the deletion is exactly the two
          // characters it names. A gap holding anything more — an argument
          // expression, a comment (`None((* why *))`), a glued effect mark
          // (`None!()`) — is the writer's text, and "delete the `()`" must not
          // delete it.
          if (
            expression.callee.kind === "Name" &&
            this.#constructorUnions.has(expression.callee.symbol)
          ) {
            const argumentList = {
              fileId: expression.span.fileId,
              start: expression.callee.span.end,
              end: expression.span.end,
            };
            const deletesExactlyParens = expression.arguments.length === 0 &&
              argumentList.end.offset - argumentList.start.offset === 2;
            this.#diagnostics.add({
              severity: "error",
              message: `\`${expression.callee.text}\` is a value, not a function; ` +
                "write it without `()`",
              primary: expression.span,
              ...(deletesExactlyParens
                ? {
                  fixes: [{
                    message: "delete the `()`",
                    edits: [{ span: argumentList, replacement: "" }],
                  }],
                }
                : {}),
            });
          } else {
            this.#diagnostics.add({
              severity: "error",
              message: notCallableMessage(
                expression,
                this.#display(knownCallee),
                arguments_.length,
              ),
              primary: expression.span,
            });
          }
          type = ERROR;
        } else {
          // The callee is not yet known to be a function, so the effect slot has
          // to be a variable the unification can solve — an absent slot would
          // read as the pure constant and pin the callee pure.
          const effect = this.#fresh(level, false);
          this.#unify(
            callee,
            {
              kind: "Function",
              parameters: arguments_,
              result,
              effect,
            },
            expression.span,
          );
          this.#registerCall(expression, effect, calleeLabel(expression));
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
      case "Unary": {
        // Numeric Literals §5.1's lift reaches unary negation too — the same
        // gate, at `Signed`. `Not` is not arithmetic and lifts nothing.
        const home = expression.operator === "Not"
          ? undefined
          : this.#operationHome("Negate", expected);
        const operand = this.#inferExpr(expression.operand, level, home);
        if (expression.operator === "Not") {
          this.#unify(operand, this.#boolType(expression.span), expression.span);
          type = this.#boolType(expression.span);
          this.#requirements.set(expression, []);
        } else {
          if (home !== undefined) {
            this.#unifyExpected(home, operand, expression.operand, expression.span, true);
          }
          const common = home ?? operand;
          const requirement = this.#require("Signed", common, expression.span);
          this.#requirements.set(expression, [requirement]);
          type = common;
        }
        break;
      }
      case "Binary":
        type = this.#inferBinary(expression, level, expected);
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
        // *(#700.)* This seat left §4.3's supplying list with the `var`
        // function-type ban (Statements §6.1): the only lambda it could land is
        // a function-typed `var`'s. The target is still elaborated first, and
        // the assignment boundary still establishes the *numeric* channel's
        // expected type through `#unifyExpected` (Numeric Literals §5.1).
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
                missingFieldMessage(
                  receiver.name,
                  [...fields.keys()],
                  expression.field.text,
                ),
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
            type = this.#unsupported(
              expression.field.span,
              missingFieldMessage(
                undefined,
                [...receiver.fields.keys()],
                expression.field.text,
              ),
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

  /**
   * The refutability refusals' tail, at the lambda-parameter seat only (Pattern
   * Matching §6.5, §6.7).
   *
   * The gate itself is untouched by #505 — a refutable pattern is still refused
   * in every binding position. What changed is that the writer of
   * `Some(x) => e` now has a construct that does what they meant, so the refusal
   * names it. It is offered at this seat alone: at a `let` or a `for..in`, a
   * match function is not the rewrite.
   */
  #matchFunctionFixit(): string {
    return this.#patternSeatIsLambdaParameter
      ? " — for a match function, write `match` with arms"
      : "";
  }

  /**
   * Pattern Matching §6.1's abstract-type refusal, in its two readings.
   *
   * The refusal itself **stands unchanged** under #513 — a scrutinee whose type
   * is a variable still cannot be matched. What changed is which programs reach
   * it: a seat's expectation now arrives before the arms are checked, so the
   * refusal is left to programs where *no seat determined the type*, and it has
   * to tell those two cases apart.
   *
   * - A **declared** variable (rigid — Functions §4.1) is determined, and
   *   abstract by declaration. It keeps the constraint-operations advice, and
   *   now names itself, as §6.1 has always quoted it: "abstract type `c`".
   * - An **undetermined inference variable** under a lambda parameter — the
   *   match function's own compiler-fresh binder included — has no constraints
   *   worth pointing at, so the advice is replaced by the rider that teaches the
   *   spellings §4.3 makes work. Both rewrites it names are legal in *both*
   *   §6.7 spellings, and neither is "annotate the parameter": a match
   *   function's parameter is compiler-fresh and cannot carry one, which is what
   *   keeps the desugar-equality (one diagnostic for both spellings) true.
   */
  #abstractScrutineeRefusal(
    scrutinee: Resolved.Expr,
    variable: Variable,
  ): string {
    const subject = "cannot match on a value of abstract type" +
      (variable.rigidName === undefined ? "" : ` \`${variable.rigidName}\``);
    const parameter = variable.rigidName === undefined &&
      scrutinee.kind === "Name" && this.#lambdaParameters.has(scrutinee.symbol);
    return `${subject}; ` + (parameter
      ? "the parameter's type is not determined here; give the parameter a " +
        "type — bind the function with its own annotated `let`, or use it " +
        "where its parameter type is known"
      : "use the operations its constraints provide");
  }

  /**
   * The nominal record's pattern eliminator (#591): Pattern Matching §2.2's
   * "constructor patterns apply to … **nominal `record` constructors**:
   * `Point(pat)` is legal and destructures through the nominal wall, where
   * `pat` matches the underlying record value".
   *
   * One reader for every pattern position, because the typing is one judgment:
   * §4's `C(p…)` clause — "the scrutinee unifies with `C`'s union (or nominal
   * record) type at a fresh instantiation; sub-patterns check against the
   * instantiated slot types". A record constructor's scheme is already
   * `{closed row} -> Point` (Products §5.1), so the instantiation the term
   * position uses answers the pattern position too, and the row a sub-pattern
   * sees cannot fork from the row `Point({x, y})` would construct.
   *
   * Arity is 1, positional (§2.2), and a miss draws the unions' own sentence —
   * the same error family, from the same spelling.
   *
   * Returns the type the single sub-pattern checks against, or `undefined` if
   * this symbol is not a record constructor at all.
   */
  #recordConstructorSlot(
    pattern: Resolved.ConstructorPattern,
    expected: Mono,
    level: number,
  ): Mono | undefined {
    if (!this.#recordConstructors.has(pattern.symbol)) return undefined;
    const shape = this.#constructorShape(pattern.symbol, level);
    // Through `#unifyPattern` like every other pattern-shape unification: both
    // walks route a record constructor pattern here, so this is the seat where
    // §7.3's obligation reaches the nominal record. Left raw, a local `record
    // Box` matched against a foreign `Box` drew the missing-cases report beside
    // the type mismatch — the double report the obligation was argued into the
    // block to remove.
    this.#unifyPattern(pattern, expected, shape.result);
    if (pattern.arguments.length !== shape.parameters.length) {
      this.#reportPatternArity(pattern, shape.parameters.length);
    }
    return shape.parameters[0] ?? ERROR;
  }

  /**
   * Pattern Matching §2.4's redirect, for a bare record pattern whose scrutinee
   * is a nominal record: "the unifier never unfolds nominal names — go through
   * the constructor pattern". Without it the user gets a type mismatch between
   * the nominal name and a row, which says nothing about the one spelling that
   * works.
   *
   * The suggested spelling wraps the fields **this pattern mentions**, so the
   * fixit is the user's own pattern moved inside the constructor: `{x, y}`
   * against a `Point` reads back as `Point({x, y})`, which is §2.4's sentence
   * verbatim.
   *
   * **Opacity intercepts the redirect** (§2.4, ruled after #591's first round).
   * Outside an opaque record's home module the constructor is private, so the
   * redirect would signpost a spelling the reader cannot write — and would name
   * the record's fields while doing it, which is the field privacy §4.2 calls
   * load-bearing. The opaque family's own refusal stands there instead, in the
   * shape its two siblings already have (the field access and the update), and
   * it leaks neither field names nor a constructor. Opacity is read through
   * `#recordRepresentationVisible`, which is exactly the reader those siblings
   * ask — off the program's copy of the declaration where this module never
   * imported it (#587/#589) — so a type that reached here without its name
   * answers the same as one that was imported. Inside the home module `opaque`
   * changes nothing (§4.2) and the redirect is what fires.
   */
  #reportNominalRecordPattern(
    pattern: Resolved.RecordPattern,
    record: NominalRecordMono,
  ): void {
    if (!this.#recordRepresentationVisible(record.record)) {
      this.#diagnostics.add({
        severity: "error",
        message: `cannot destructure opaque record \`${record.name}\`; ` +
          "use an operation exported by its home module",
        primary: pattern.span,
      });
      return;
    }
    const fields = pattern.fields.map(({ name }) => name);
    this.#diagnostics.add({
      severity: "error",
      message: `\`${record.name}\` is a nominal record; destructure it with ` +
        `\`${record.name}({${fields.join(", ")}})\``,
      primary: pattern.span,
    });
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
      this.#unifyPattern(pattern, expected, UNIT);
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
      return;
    }
    if (pattern.kind === "Constructor") {
      // #591: a record constructor pattern goes through its own slot — Products
      // §5.1's `{closed row} -> Point`, read from the pattern side — before the
      // union lookup that cannot answer for it.
      //
      // No arm of this walk decides refutability any more. The gate is §5.1's
      // one algorithm, run once over the whole pattern by `#checkBindingPattern`
      // at the seat; this walk's job is types and binders, and it therefore
      // descends through *every* constructor rather than only the sole one — a
      // refutable pattern still binds the names it writes, and reporting from
      // here used to cost them.
      const slot = this.#recordConstructorSlot(pattern, expected, level);
      if (slot !== undefined) {
        pattern.arguments.forEach((argument, index) =>
          this.#inferPattern(
            argument,
            index === 0 ? slot : ERROR,
            level,
            generalizable,
            evaluated,
          )
        );
        return;
      }
      const unionId = this.#constructorUnions.get(pattern.symbol) ??
        this.#programConstructorUnion(pattern.symbol);
      if (unionId !== undefined) this.#materializeReachedUnion(unionId);
      const union = unionId === undefined ? undefined : this.#unions.get(unionId);
      const constructor = union?.constructors.find(
        ({ binding }) => binding.symbol === pattern.symbol,
      );
      if (constructor === undefined) return;
      const shape = this.#constructorShape(constructor.binding.symbol, level);
      const parameters = shape.parameters;
      this.#unifyPattern(pattern, expected, shape.result);
      if (pattern.arguments.length !== parameters.length) {
        this.#reportPatternArity(pattern, parameters.length);
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
    if (pattern.kind === "Integer") {
      this.#unifyPattern(pattern, expected, primitive("Int"));
      return;
    }
    if (pattern.kind === "String") {
      this.#unifyPattern(pattern, expected, primitive("String"));
      return;
    }

    if (pattern.kind === "Vector") {
      const element = this.#fresh(level + 1, false);
      const vector: VectorMono = { kind: "Vector", element };
      this.#unifyPattern(pattern, expected, vector);
      for (const nested of pattern.elements) {
        this.#inferPattern(nested, element, level, generalizable, evaluated);
      }
      if (pattern.rest?.pattern !== undefined) {
        this.#inferPattern(pattern.rest.pattern, vector, level, generalizable, evaluated);
      }
      return;
    }

    if (pattern.kind === "Record") {
      const scrutinee = this.#prune(expected);
      if (scrutinee.kind === "NominalRecord") {
        // §2.4: the redirect, not the row-versus-name mismatch the unification
        // below would have produced. Sub-patterns still walk, at `ERROR`, so
        // their binders exist and nothing downstream reports a second time.
        this.#reportNominalRecordPattern(pattern, scrutinee);
        for (const fieldPattern of pattern.fields) {
          this.#inferPattern(fieldPattern.pattern, ERROR, level, generalizable, evaluated);
        }
        return;
      }
      const fields = new Map<string, Mono>();
      for (const fieldPattern of pattern.fields) {
        const field = this.#fresh(level + 1, false);
        fields.set(fieldPattern.name, field);
      }
      this.#unifyPattern(pattern, expected, {
        kind: "Record",
        fields,
        tail: this.#fresh(level + 1, false),
      });
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
    this.#unifyPattern(pattern, expected, { kind: "Tuple", elements });
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
      this.#unifyPattern(pattern, expected, UNIT);
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
      this.#unifyPattern(pattern, expected, primitive("Int"));
      return;
    }
    if (pattern.kind === "String") {
      this.#unifyPattern(pattern, expected, primitive("String"));
      return;
    }
    if (pattern.kind === "Tuple") {
      const elements = pattern.elements.map(() => this.#fresh(level, false));
      this.#unifyPattern(pattern, expected, { kind: "Tuple", elements });
      pattern.elements.forEach((element, index) =>
        this.#inferMatchPattern(element, elements[index] ?? ERROR, level)
      );
      return;
    }
    if (pattern.kind === "Vector") {
      const element = this.#fresh(level, false);
      const vector: VectorMono = { kind: "Vector", element };
      this.#unifyPattern(pattern, expected, vector);
      for (const nested of pattern.elements) this.#inferMatchPattern(nested, element, level);
      if (pattern.rest?.pattern !== undefined) {
        this.#inferMatchPattern(pattern.rest.pattern, vector, level);
      }
      return;
    }
    if (pattern.kind === "Record") {
      const scrutinee = this.#prune(expected);
      if (scrutinee.kind === "NominalRecord") {
        // §2.4's redirect in arm position; see `#inferPattern`'s twin.
        this.#reportNominalRecordPattern(pattern, scrutinee);
        for (const field of pattern.fields) {
          this.#inferMatchPattern(field.pattern, ERROR, level);
        }
        return;
      }
      const fields = new Map(
        pattern.fields.map((field) => [field.name, this.#fresh(level, false)]),
      );
      this.#unifyPattern(pattern, expected, {
        kind: "Record",
        fields,
        tail: this.#fresh(level, false),
      });
      for (const field of pattern.fields) {
        this.#inferMatchPattern(
          field.pattern,
          fields.get(field.name) ?? ERROR,
          level,
        );
      }
      return;
    }

    // The nominal record's constructor pattern (#591), before the union
    // lookup that cannot answer for it.
    const slot = this.#recordConstructorSlot(pattern, expected, level);
    if (slot !== undefined) {
      pattern.arguments.forEach((argument, index) =>
        this.#inferMatchPattern(argument, index === 0 ? slot : ERROR, level)
      );
      return;
    }

    // The union may have reached this module through nothing but an imported
    // signature, and a pattern is the seat where the expectation cannot be asked
    // instead: a constructor arm against a `String` scrutinee has no union type
    // to prune, which is how #605's vacuous accept passed. The symbol answers.
    const unionId = this.#constructorUnions.get(pattern.symbol) ??
      this.#programConstructorUnion(pattern.symbol);
    if (unionId !== undefined) this.#materializeReachedUnion(unionId);
    const union = unionId === undefined ? undefined : this.#unions.get(unionId);
    if (union === undefined) return;
    const constructor = union.constructors.find(
      ({ binding }) => binding.symbol === pattern.symbol,
    );
    if (constructor === undefined) return;
    const shape = this.#constructorShape(constructor.binding.symbol, level);
    const parameters = shape.parameters;
    this.#unifyPattern(pattern, expected, shape.result);
    if (pattern.arguments.length !== parameters.length) {
      this.#reportPatternArity(pattern, parameters.length);
    }
    pattern.arguments.forEach((argument, index) =>
      this.#inferMatchPattern(argument, parameters[index] ?? ERROR, level)
    );
  }

  /**
   * A block of catch arms, in either of `catch`'s two seats — `try`'s clause
   * (Exceptions §5.1) and the match catch clause (§5.4). One grammar, one
   * semantics: §5.3's exact reachability set logic, no exhaustiveness demand
   * (the sum is open), and every arm body unified into the one result type.
   */
  #checkCatchArms(
    arms: readonly Resolved.MatchArm[],
    result: Mono,
    level: number,
    expected?: Mono,
  ): void {
    for (const arm of arms) {
      this.#inferExceptionPattern(arm.pattern, level);
      if (arm.guard !== undefined) {
        const guard = this.#inferExpr(arm.guard, level);
        this.#unify(guard, this.#boolType(arm.guard.span), arm.guard.span);
      }
      // Catch arms are value paths of the construct holding them, so they
      // forward the expectation exactly as data arms do (§4.3).
      this.#unify(result, this.#inferExpr(arm.body, level, expected), arm.body.span);
    }
    // §5.3's set logic is §7.2's usefulness over the open `Exn` sum: the column
    // has no signature, so no set of exception constructors ever completes it —
    // which is the open model — while a repeated constructor, and anything
    // behind a bare binder, is as dead here as anywhere.
    this.#checkArmReachability(arms, primitive("Exn"), CATCH_ARM_REPORTS);
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
      this.#brokenPatterns.add(pattern);
    }
    pattern.arguments.forEach((argument, index) =>
      this.#inferMatchPattern(argument, shape.parameters[index] ?? ERROR, level)
    );
  }

  /**
   * The three scope tables Pattern Matching §7.3's tiers are judged against,
   * read off the resolved module once per check.
   *
   * Nameability is a property of the **reporting** module — what it imported,
   * what aliases it holds, what it declared, and which prelude names survived
   * occlusion — so the answer has to come from the resolver's own record of its
   * scoping (Modules §5.4/§5.5). Re-deriving it here would be writing Hexagon's
   * scope rule a second time in a copy nothing keeps honest.
   */
  #buildSpellingTables(module: Resolved.Module): void {
    const bare = new Map<string, Resolved.SymbolId>();
    for (const region of module.scopes) {
      for (const binding of region.bindings) bare.set(binding.name, binding.symbol);
    }
    const spellings = new Map<Resolved.SymbolId, string>();
    for (const [name, symbol] of bare) {
      if (!spellings.has(symbol)) spellings.set(symbol, name);
    }
    const qualifications = new Map<Resolved.SymbolId, string>();
    const aliasNames = new Set<string>();
    for (const { alias, members } of module.moduleAliases) {
      // First entry wins: the resolver lists this module's own aliases before
      // the prelude's, so a user alias of a prelude module's name shadows the
      // ambient one — Modules §5.4, and §7.3's one corner with no import.
      if (aliasNames.has(alias)) continue;
      aliasNames.add(alias);
      for (const member of members) {
        if (!qualifications.has(member.symbol)) {
          qualifications.set(member.symbol, `${alias}.${member.name}`);
        }
      }
    }
    this.#bareNames = bare;
    this.#bareSpellings = spellings;
    this.#aliasQualifications = qualifications;
    this.#aliasNames = aliasNames;
    this.#brokenPatterns.clear();
  }

  /**
   * Pattern Matching §7.3's tiers, for one constructor occurrence in a witness:
   * "each constructor name in a witness prints in the spelling the reporting
   * module can lawfully write, preferring the barest one."
   *
   * 1. **Bare**, where a bare spelling in scope denotes *this* constructor —
   *    declared here, imported by name (under whatever local name the import
   *    bound), or the prelude's unshadowed name. The ordinary case, byte for
   *    byte what the witness said before this rule.
   * 2. **Qualified**, where bare would be wrong or absent but a module alias
   *    reaches it — `Bool.True` past an occluding local `True`, `A.Off` through
   *    an `import module` alias.
   * 3. **Bare, with the route stated**, where neither exists. The witness keeps
   *    the bare name and the message says where it lives; the route itself is
   *    rendered once per declaring module by `#routeClause`, and only for the
   *    witnesses a report actually lists.
   */
  #constructorSpelling(
    binding: Resolved.Binding,
    home: { readonly path: string | undefined; readonly prelude: boolean },
  ): { readonly text: string; readonly route?: RouteNeed } {
    if (this.#bareNames.get(binding.name) === binding.symbol) return { text: binding.name };
    const local = this.#bareSpellings.get(binding.symbol);
    if (local !== undefined) return { text: local };
    const qualified = this.#aliasQualifications.get(binding.symbol);
    if (qualified !== undefined) return { text: qualified };
    if (home.path === undefined) return { text: binding.name };
    return {
      text: binding.name,
      route: { name: binding.name, path: home.path, prelude: home.prelude },
    };
  }

  /**
   * §7.3's route clauses for the constructors a report actually listed — "one
   * route clause per declaring module, covering the listed names that lack a
   * pastable spelling", the "…and N more" tail naming none and so routing none.
   *
   * The repair is computed from the exported inventory rather than asserted: a
   * union that reached this module crossed an exported face, so Modules §4.3
   * makes its constructors importable severally, and the only obstacle left is
   * a **taken spelling** — which the module route always clears, since an alias
   * for the declaring module cannot already be in scope (tier 2 would have
   * fired) and the importer picks the name.
   */
  #routeClauses(routes: readonly RouteNeed[]): string {
    if (routes.length === 0) return "";
    // One clause per declaring **module**, not per type: two types from one file
    // share an import line, and the reader wants one edit.
    const byModule = new Map<string, { readonly prelude: boolean; readonly names: string[] }>();
    for (const route of routes) {
      const group = byModule.get(route.path) ??
        { prelude: route.prelude, names: [] };
      if (!group.names.includes(route.name)) group.names.push(route.name);
      byModule.set(route.path, group);
    }
    return [...byModule].flatMap(([path, { prelude, names }]) => {
      const clause = this.#routeClause(path, prelude, names);
      return clause === undefined ? [] : [` — ${clause}`];
    }).join("");
  }

  /** One declaring module's clause; `undefined` where there is nothing to say. */
  #routeClause(
    path: string,
    prelude: boolean,
    names: readonly string[],
  ): string | undefined {
    const listed = englishList(names.map((name) => `\`${name}\``));
    const plural = names.length > 1;
    // The one corner with no import to name (§7.3): a prelude constructor whose
    // bare spelling is occluded *and* whose prelude module's ambient name is
    // taken by a module alias. Prelude modules have no importable path, so the
    // clause states the shadowing and the repair is the alias's rename.
    if (prelude) {
      const home = moduleBaseName(path);
      if (home === undefined) return undefined;
      const spelled = englishList(names.map((name) => `\`${home}.${name}\``));
      return `${listed} ${plural ? "are" : "is"} declared in the prelude module ` +
        `\`${home}\`, and this module's \`${home}\` alias shadows it; rename that ` +
        `alias to spell ${plural ? "them" : "it"} ${spelled}`;
    }
    if (this.#modulePath === undefined) return undefined;
    const specifier = relativeSpecifier(this.#modulePath, path);
    const taken = names.filter((name) => this.#bareNames.has(name));
    if (taken.length === 0) {
      return `${listed} ${plural ? "are" : "is"} declared in \`${specifier}\`; ` +
        `\`import { ${names.join(", ")} } from "${specifier}"\` to spell ` +
        `${plural ? "them" : "it"} here`;
    }
    const alias = this.#derivedAlias(path);
    const spelled = englishList(names.map((name) => `\`${alias}.${name}\``));
    return `${listed} ${plural ? "are" : "is"} declared in \`${specifier}\`, and this ` +
      `module binds ${englishList(taken.map((name) => `another \`${name}\``))}; ` +
      `\`import module ${alias} from "${specifier}"\` and spell ` +
      `${plural ? "them" : "it"} ${spelled}`;
  }

  /**
   * The alias the module-import repair offers, derived from the declaring
   * module's file name: `./flags` → `Flags`, `./my-flags` → `MyFlags`. Any
   * spelling already bound here — as a module alias or as anything else — takes
   * a `_1`, `_2`… suffix, so the repair the clause prints is one the compiler
   * would accept (Modules §5.2 refuses a rebinding).
   *
   * `minted` carries the aliases **this message** has already coined, so the
   * edits one report offers compose: two declaring modules with one basename
   * (`/a/lib.hex` and `/b/lib.hex`) would otherwise both be advised as `Lib`,
   * and applying the pair would rebind the alias (Constraints §5.1.1 — "the
   * aliases one message binds are chosen mutually distinct, as well as distinct
   * from every spelling in scope"). Empty for the witness-route caller, which
   * groups by module before it asks and so never coins twice in one report.
   */
  #derivedAlias(path: string, minted: ReadonlySet<string> = new Set()): string {
    const base = moduleBaseName(path) ?? "M";
    const candidate = /^[A-Za-z]/u.test(base) ? base : `M${base}`;
    const taken = (name: string): boolean =>
      this.#aliasNames.has(name) || this.#bareNames.has(name) || minted.has(name);
    if (!taken(candidate)) return candidate;
    for (let suffix = 1;; suffix += 1) {
      const next = `${candidate}_${suffix}`;
      if (!taken(next)) return next;
    }
  }

  /**
   * Constraints §5.1.1's **advised-spelling law**, for one report's required
   * constraints: each is spelled by the form that resolves *here* to the
   * declaration required, and the ones no form reaches carry the module route
   * the report then states.
   *
   * The tiers, in order:
   *
   * 1. **Bare** — a name in scope denoting this declaration: its own word, or
   *    the word a renaming import bound (Modules §3.2). The eleven
   *    pre-registered identities always land here; they seed the map.
   * 2. **Qualified** — `Alias.Name` through a module alias in scope, which the
   *    resolver enters into the same map under that exact spelling (§3.3).
   * 3. **Routed** — no spelling resolves, so the advice qualifies through an
   *    alias its own clause binds. Never a *named* import: a same-spelled group
   *    could not take one (Modules §5.2 refuses the collision, and the renaming
   *    pair would have the advice coin constraint vocabulary), so the one repair
   *    is uniform over the group and over the singleton alike.
   * 4. **Sealed** — no route either. Two ways in, and the reports tell them
   *    apart: the constraint is *not exported* (Modules §4.3's gate, §6.5's
   *    private base), which is a fact about the declaration and is stated as
   *    one; or there is no path to write an import against — a declaration the
   *    graph reached without one, a compilation with no paths at all — which
   *    establishes nothing about exporting and so is reported without the
   *    claim. Either way no spelling is returned and the caller offers no
   *    rewrite; `unexported` is which sentence it may print.
   *
   * Contested groups need no branch of their own: tier 3 is the module route
   * whether one required constraint wants it or three do, so a member the
   * module can already spell keeps its word and every other member routes.
   */
  #constraintSpellings(
    required: readonly { readonly name: string; readonly identity: string }[],
  ): readonly ConstraintSpelling[] {
    const minted = new Map<string, string>();
    const coined = new Set<string>();
    return required.map(({ name, identity }): ConstraintSpelling => {
      const declared = this.#canonicalConstraintName(name, identity);
      const spelling = this.#spelledConstraint(identity, declared);
      if (spelling !== undefined) return { kind: "spelled", text: spelling };
      const declaration = this.#constraintsByIdentity.get(identity);
      const path = declaration?.declaringPath;
      if (
        declaration === undefined || !declaration.exported ||
        path === undefined || this.#modulePath === undefined
      ) {
        return {
          kind: "sealed",
          name: declared,
          identity,
          // The sealing gate is the *reported* one only where the declaration
          // says so. A missing path is a different obstacle wearing the same
          // outcome, and a message asserting "not exported" over it would state
          // a fact nothing established.
          unexported: declaration !== undefined && !declaration.exported,
        };
      }
      let alias = minted.get(path);
      if (alias === undefined) {
        alias = this.#derivedAlias(path, coined);
        minted.set(path, alias);
        coined.add(alias);
      }
      return { kind: "routed", text: `${alias}.${declared}`, name: declared, path, alias };
    });
  }

  /**
   * Tiers 1 and 2 of the law: the barest spelling in scope denoting `identity`,
   * or `undefined` where none does.
   *
   * `#constraintIdentities` is exactly "every constraint name this module can
   * spell", qualified forms included, so the search is over it rather than over
   * the program — a declaration the import graph reaches but this module has no
   * word for must not be offered one.
   */
  #spelledConstraint(identity: string, declared: string): string | undefined {
    if (this.#constraintIdentities.get(declared) === identity) return declared;
    let qualified: string | undefined;
    for (const [spelling, known] of this.#constraintIdentities) {
      if (known !== identity) continue;
      if (!spelling.includes(".")) return spelling;
      qualified ??= spelling;
    }
    return qualified;
  }

  /**
   * The route clauses one report owes for the spellings that took tier 3 — the
   * witness grammar of Pattern Matching §7.3, one clause per declaring module.
   *
   * `home` is the law's **elision licence**: where the message has already named
   * the declaring module — the refusal arms do, in their collision
   * qualification — the clause drops its "declared in" half and states the edit
   * alone; where it has not, as at the completeness advice, the clause stands
   * whole.
   */
  #constraintRouteClauses(
    spellings: readonly ConstraintSpelling[],
    home: boolean,
  ): string {
    const byModule = new Map<
      string,
      { readonly alias: string; readonly names: string[] }
    >();
    for (const spelling of spellings) {
      if (spelling.kind !== "routed") continue;
      const group = byModule.get(spelling.path) ?? { alias: spelling.alias, names: [] };
      if (!group.names.includes(spelling.name)) group.names.push(spelling.name);
      byModule.set(spelling.path, group);
    }
    return [...byModule].map(([path, { alias, names }]) =>
      ` — ${this.#constraintRouteClause(path, alias, names, home)}`
    ).join("");
  }

  /** One declaring module's constraint route clause; see `#constraintRouteClauses`. */
  #constraintRouteClause(
    path: string,
    alias: string,
    names: readonly string[],
    home: boolean,
  ): string {
    const specifier = relativeSpecifier(this.#modulePath!, path);
    const plural = names.length > 1;
    const spelled = englishList(names.map((name) => `\`${alias}.${name}\``));
    const edit = `\`import module ${alias} from ${JSON.stringify(specifier)}\` and spell ` +
      `${plural ? "them" : "it"} ${spelled}`;
    if (!home) return edit;
    const listed = englishList(names.map((name) => `\`${name}\``));
    // The half the constructor clause states for the same reason: a word this
    // module already binds is why the named import is not the repair, and the
    // reader is owed that sentence rather than left to find it.
    const taken = names.filter((name) => this.#constraintIdentities.has(name));
    const binds = taken.length === 0
      ? ""
      : `, and this module binds ${englishList(taken.map((name) => `another \`${name}\``))}`;
    return `${listed} ${plural ? "are" : "is"} declared in \`${specifier}\`${binds}; ${edit}`;
  }

  /**
   * `./lib.hex` for a constraint a message must qualify by its home —
   * Constraints §5.1.1's disambiguation bullet, whose two forms are "this
   * module's" for a declaration written here and the relative path for one
   * written elsewhere. `undefined` for both the local case and the case with no
   * path a reader could open (a pre-registered constraint's prelude home, a
   * compilation with no paths at all), which the sentences read correctly
   * without.
   */
  #constraintHomePath(identity: string): string | undefined {
    if (isPreRegisteredIdentity(identity)) return undefined;
    const home = this.#constraintsByIdentity.get(identity)?.declaringPath;
    if (home === undefined || this.#modulePath === undefined) return undefined;
    if (home === this.#modulePath) return undefined;
    return relativeFilePath(this.#modulePath, home);
  }

  /**
   * The disambiguating qualification itself: `` this module's `Heft` `` or
   * `` the `Heft` declared in `./lib.hex` ``. Collision-only by construction —
   * every caller asks only after finding two declarations under one word, which
   * is the resolution §5.1.1 reserves it for, never the default.
   */
  #qualifiedConstraintMention(name: string, identity: string): string {
    const home = this.#constraintHomePath(identity);
    return home === undefined
      ? `this module's \`${name}\``
      : `the \`${name}\` declared in \`${home}\``;
  }

  /**
   * The fourth tier's subject, as every report that reaches it names it: the
   * constraint, its declaring module where there is one to open, and the gate
   * itself where the declaration established it.
   *
   * Shared so the export seat and the four refusal arms cannot drift into
   * saying different things about one specimen, and so the "not exported"
   * clause appears in exactly one place — the only place that knows it is true.
   */
  #sealedConstraintMention(
    sealed: Extract<ConstraintSpelling, { readonly kind: "sealed" }>,
  ): string {
    const home = this.#constraintHomePath(sealed.identity);
    const subject = `the constraint \`${sealed.name}\``;
    if (sealed.unexported) {
      return home === undefined
        ? `${subject}, which is not exported`
        : `${subject}, declared in \`${home}\` and not exported`;
    }
    return home === undefined
      ? `${subject}, which this module has no spelling for`
      : `${subject} declared in \`${home}\`, which this module has no spelling for`;
  }

  /**
   * Pattern Matching §7's matrix, one column at a time: what the column's type
   * admits, and how a pattern splits against it.
   *
   * `patterns` are the head patterns that column holds — needed by two domains:
   * the structural record, whose columns are built "over the union of mentioned
   * fields, absent mentions widening to `_`" (§7.1), and the vector, whose
   * length signature reaches exactly as far as its patterns can tell lengths
   * apart. Every other domain answers from its type alone.
   *
   * **A broken pattern reads as `_` here** (§7.3's error-program obligation):
   * it neither splits the column nor contributes to a derived signature, which
   * is the maximal-cover grant stated in the matrix's own terms. The grant is
   * for the coverage judgments; §7.2's dual is taken at `#checkArmReachability`,
   * where a row carrying a broken pattern is simply not a shadower.
   */
  #coverageColumn(
    type: Mono,
    headPatterns: readonly Resolved.Pattern[],
  ): CoverageColumn {
    // `headPatterns` is exactly the set `split` will be asked about — both
    // callers pass the first column of the matrix they then split — so a column
    // with none of them broken needs neither the filter nor the wrapper, and
    // the ordinary compile pays one scan.
    const broken = this.#brokenPatterns.size > 0 &&
      headPatterns.some((pattern) => this.#brokenPatterns.has(pattern));
    const column = this.#coverageDomain(
      type,
      broken
        ? headPatterns.filter((pattern) => !this.#brokenPatterns.has(pattern))
        : headPatterns,
    );
    if (!broken) return column;
    return {
      ...(column.signature === undefined ? {} : { signature: column.signature }),
      split: (pattern) =>
        this.#brokenPatterns.has(pattern) ? undefined : column.split(pattern),
    };
  }

  #coverageDomain(
    type: Mono,
    patterns: readonly Resolved.Pattern[],
  ): CoverageColumn {
    const actual = this.#prune(type);
    switch (actual.kind) {
      case "Union":
        return this.#unionColumn(actual, patterns);
      case "NominalRecord":
        return this.#nominalRecordColumn(actual);
      case "Tuple":
        return this.#tupleColumn(actual);
      case "Record":
        return this.#structuralRecordColumn(actual, patterns);
      case "Vector":
        return this.#vectorColumn(actual, patterns);
      case "Variable":
      case "Error":
        // Nothing is known about this domain, so nothing may be concluded from
        // it: every pattern reads as a wildcard, and the column neither
        // discriminates nor blocks. A column stays here only where inference
        // never settled it — a rigid parameter, or a type an earlier report
        // already spoke for — and in both cases the patterns that reached it
        // are wildcards, because anything else would have concretized it.
        // (This is the seat of #594's measurement 2 in reverse: the old
        // fallback answered "refutable" for a constructor here, on a slot that
        // was only shapeless because it was read off the declaration.)
        return { split: () => undefined };
      default:
        return this.#openColumn();
    }
  }

  /**
   * A column with no signature: the infinite domains and the open `Exn` sum.
   * Patterns here still split — a literal groups with its equal, an exception
   * constructor with its own — so reachability is exact; what they never do is
   * complete, which is §7.1's "a catch-all is required".
   */
  #openColumn(): CoverageColumn {
    return {
      split: (pattern) => {
        if (pattern.kind === "Wildcard" || pattern.kind === "Binding") {
          return undefined;
        }
        if (pattern.kind === "Integer" || pattern.kind === "String") {
          return oneHead(
            { key: `literal:${renderLiteralPatternKey(pattern)}`, slots: [], print: () => "_" },
            [],
          );
        }
        if (pattern.kind === "Constructor" && this.#exceptions.has(pattern.symbol)) {
          const shape = this.#constructorShape(pattern.symbol, 0);
          const name = pattern.text;
          const head: CoverageHead = {
            key: constructorHeadKey(pattern.symbol),
            slots: shape.parameters,
            print: (witnesses) =>
              witnesses.length === 0 ? name : `${name}(${witnesses.join(", ")})`,
          };
          return oneHead(head, this.#alignedSlots(pattern, head.slots.length));
        }
        return distinctHead(pattern);
      },
    };
  }

  /** A closed union's signature — Unions §4.3's constructor set, instantiated. */
  #unionColumn(
    type: UnionMono,
    patterns: readonly Resolved.Pattern[],
  ): CoverageColumn {
    this.#materializeReachedUnion(type.union);
    const union = this.#unions.get(type.union);
    if (union === undefined) return this.#assumedColumn(patterns);
    const heads = new Map<string, CoverageHead>(
      union.constructors.map((constructor) => {
        const head = this.#unionConstructorHead(type, constructor.binding);
        return [head.key, head];
      }),
    );
    return {
      signature: [...heads.values()],
      split: (pattern) => {
        if (pattern.kind === "Wildcard" || pattern.kind === "Binding") {
          return undefined;
        }
        if (pattern.kind !== "Constructor") return distinctHead(pattern);
        const head = heads.get(constructorHeadKey(pattern.symbol));
        if (head === undefined) return distinctHead(pattern);
        return oneHead(head, this.#alignedSlots(pattern, head.slots.length));
      },
    };
  }

  /**
   * The column for a union whose declaration is nowhere the checker can read it.
   *
   * Both routes that used to arrive here are closed. A union reached only
   * through an imported function's result type is registered from the program
   * table before this is asked (#605, `#materializeReachedUnion`), and a
   * **private** type carried abroad takes that same route: the accumulation is
   * of every declaration a module resolved, `export` or not, so the escape
   * `#checkPublicSignatures` reports at the exporter is now the whole report and
   * the importer's match is judged against the real constructor set.
   *
   * What is left is a compilation with no program table to read — a lone
   * `check`, which has no module graph and therefore no union it did not
   * declare. The answer below is the one that adds nothing to a program the
   * checker cannot judge: the patterns are taken *as* the signature, which lets
   * the column tell two constructors apart so §7.2 keeps working, and stops it
   * naming a case missing from a set it cannot enumerate. Its price is the one
   * #605 recorded — a signature complete by construction leaves a trailing `_`
   * nothing to cover, and a genuinely non-exhaustive match nothing to miss — so
   * this must stay the answer of last resort and never a fallback a real
   * compilation reaches.
   */
  #assumedColumn(patterns: readonly Resolved.Pattern[]): CoverageColumn {
    const heads = new Map<string, CoverageHead>();
    for (const pattern of patterns) {
      if (pattern.kind !== "Constructor") continue;
      const key = constructorHeadKey(pattern.symbol);
      if (heads.has(key)) continue;
      const name = pattern.text;
      heads.set(key, {
        key,
        slots: pattern.arguments.map(() => ERROR),
        print: (witnesses) =>
          witnesses.length === 0 ? name : `${name}(${witnesses.join(", ")})`,
      });
    }
    return {
      signature: [...heads.values()],
      split: (pattern) => {
        if (pattern.kind !== "Constructor") return undefined;
        const head = heads.get(constructorHeadKey(pattern.symbol));
        return head === undefined
          ? undefined
          : oneHead(head, this.#alignedSlots(pattern, head.slots.length));
      },
    };
  }

  /**
   * One union constructor's head, with its slot types **instantiated at the
   * column's arguments** — §4's "the scrutinee unifies with `C`'s union type at
   * a fresh instantiation; sub-patterns check against the instantiated slot
   * types", read by the coverage side rather than only the typing side.
   *
   * The instantiation is the one the typing side already performs
   * (`#constructorShape`), and the substitution is read back off its own result
   * type, so the shapes a sub-pattern is judged against cannot fork from the
   * shapes it was checked against.
   */
  #unionConstructorHead(
    type: UnionMono,
    binding: Resolved.Binding,
  ): CoverageHead {
    const shape = this.#constructorShape(binding.symbol, 0);
    const result = this.#prune(shape.result);
    const replacements = new Map<number, Mono>();
    if (result.kind === "Union") {
      result.arguments.forEach((argument, index) => {
        const parameter = this.#prune(argument);
        if (parameter.kind === "Variable") {
          replacements.set(parameter.id, type.arguments[index] ?? ERROR);
        }
      });
    }
    const slots = shape.parameters.map((parameter) =>
      this.#replaceVariables(parameter, replacements)
    );
    // §7.3's tiers, judged per occurrence: the barest spelling this module can
    // lawfully write for *this* constructor — which is the declared name in the
    // ordinary case, and is not it under occlusion, a rename, or an alias.
    const { text: name, route } = this.#constructorSpelling(binding, {
      path: this.#programUnion(type.union)?.declaringPath ??
        this.#unions.get(type.union)?.declaringPath,
      prelude: this.#preludeUnionIds.has(type.union),
    });
    return {
      key: constructorHeadKey(binding.symbol),
      slots,
      print: (witnesses) =>
        witnesses.length === 0 ? name : `${name}(${witnesses.join(", ")})`,
      ...(route === undefined ? {} : { route }),
    };
  }

  /**
   * A nominal record's one-constructor signature (#591): §7.1's finite-shape
   * clause applies to it exactly as to a one-constructor union, and its slot is
   * the **instantiated** field row — the same row `#nominalRecordFields` hands
   * `p.x` and `{p with …}`.
   *
   * **Opacity keeps the row out of the witness** (Modules §4.2, the constraint
   * #591's ruling attached to every diagnostic that could name a private
   * field). Outside the home module the head decomposes nothing and prints at
   * constructor granularity, and nothing is lost by that: the constructor is
   * private there, so no pattern this module can write would have decomposed it
   * either. A diagnostic never signposts a spelling the reader cannot write.
   */
  #nominalRecordColumn(type: NominalRecordMono): CoverageColumn {
    const declaration = this.#records.get(type.record) ?? this.#programRecord(type.record);
    const constructor = declaration?.constructor;
    if (constructor === undefined) return this.#openColumn();
    const slots: readonly Mono[] = this.#recordRepresentationVisible(type.record)
      ? [{ kind: "Record", fields: new Map(this.#nominalRecordFields(type)) }]
      : [];
    // §7.3's tiers reach this constructor too: a record reached through an
    // `import module` alias is written `H.Box({…})` in a pattern, so a witness
    // that printed `Box({…})` would name a spelling this module cannot write.
    const { text: name, route } = this.#constructorSpelling(constructor, {
      path: this.#programRecord(type.record)?.declaringPath ?? declaration?.declaringPath,
      prelude: this.#preludeRecordIds.has(type.record),
    });
    const head: CoverageHead = {
      key: constructorHeadKey(constructor.symbol),
      slots,
      ...(route === undefined ? {} : { route }),
      print: (witnesses) => `${name}(${witnesses[0] ?? "_"})`,
    };
    return {
      signature: [head],
      split: (pattern) => {
        if (pattern.kind === "Wildcard" || pattern.kind === "Binding") {
          return undefined;
        }
        // A bare record pattern here has already drawn §2.4's redirect (or the
        // opaque family's refusal). It reads as a wildcard so the one defect is
        // reported once, rather than trailing a coverage report behind it.
        if (pattern.kind === "Record") return undefined;
        if (pattern.kind !== "Constructor" || pattern.symbol !== constructor.symbol) {
          return distinctHead(pattern);
        }
        return oneHead(head, this.#alignedSlots(pattern, head.slots.length));
      },
    };
  }

  /** The tuple's one shape (§5.1: "tuples have one shape"), `Unit` included. */
  #tupleColumn(type: TupleMono): CoverageColumn {
    const head: CoverageHead = {
      key: "tuple",
      slots: type.elements,
      print: (witnesses) => `(${witnesses.join(", ")})`,
    };
    return {
      signature: [head],
      split: (pattern) => {
        if (pattern.kind === "Wildcard" || pattern.kind === "Binding") {
          return undefined;
        }
        // #159: `()` is the arity-0 tuple pattern, so it splits through this
        // same head rather than a case of its own.
        if (pattern.kind === "Unit") {
          return type.elements.length === 0
            ? oneHead(head, [])
            : distinctHead(pattern);
        }
        if (
          pattern.kind !== "Tuple" ||
          pattern.elements.length !== type.elements.length
        ) return distinctHead(pattern);
        return oneHead(head, pattern.elements);
      },
    };
  }

  /**
   * A structural record's one shape, decomposed over the **mentioned** fields
   * only (§7.1) — sound because record patterns are open, so a field no arm
   * mentions cannot distinguish arms.
   *
   * The field order is the row's, not the mention order, so the column is the
   * same matrix whichever arm happened to mention a field first.
   */
  #structuralRecordColumn(
    type: RecordMono,
    patterns: readonly Resolved.Pattern[],
  ): CoverageColumn {
    const row = this.#normalizeRecord(type).fields;
    const mentioned = new Set(
      patterns.flatMap((pattern) =>
        pattern.kind === "Record" ? pattern.fields.map(({ name }) => name) : []
      ),
    );
    const names = [...row.keys()].filter((name) => mentioned.has(name));
    const head: CoverageHead = {
      key: "record",
      slots: names.map((name) => row.get(name) ?? ERROR),
      // §7.3: "records with only the discriminating fields — never invent
      // mentions". A field whose witness is `_` discriminates nothing, and a
      // record that discriminates nothing is `_`.
      print: (witnesses) => {
        const shown = names.flatMap((name, index) => {
          const witness = witnesses[index];
          return witness === undefined || witness === "_" ? [] : [`${name} = ${witness}`];
        });
        return shown.length === 0 ? "_" : `{${shown.join(", ")}}`;
      },
    };
    return {
      signature: [head],
      split: (pattern) => {
        if (pattern.kind === "Wildcard" || pattern.kind === "Binding") {
          return undefined;
        }
        if (pattern.kind !== "Record") return distinctHead(pattern);
        const mentions = new Map(
          pattern.fields.map((field) => [field.name, field.pattern]),
        );
        return oneHead(
          head,
          names.map((name) => mentions.get(name) ?? wildcardAt(pattern.span)),
        );
      },
    };
  }

  /**
   * The vector's signature: **its lengths** (Collections Part 3 §3.3, the Rust
   * slice-pattern treatment), "integrated into the one Pattern Matching §7
   * algorithm — no second machinery".
   *
   * Lengths are unbounded, so the signature cannot be one head per length. It
   * is one head per length the column's own patterns can tell apart, and one
   * variadic head for everything past that: the heads are the fixed lengths
   * `0 … bound - 1` and a last head standing for every length `≥ bound`.
   *
   * `bound` is `max(widest + 1, maxFront + maxBack)`. `widest` is the largest
   * slot count any vector pattern here carries, so every fixed-length pattern
   * gets a head of its own and none of them reaches the variadic one.
   * `maxFront` and `maxBack` are the largest front region and the largest back
   * region the rest patterns here carry, and the two maxima are taken
   * **independently**: a front-heavy arm and a back-heavy arm are different
   * patterns, each keeping its own reach, and their two regions stop
   * overlapping only at `maxFront + maxBack`. (This is rustc's `max_slice` for
   * slice patterns — the treatment §3.3 names.) One arm's own front and back
   * sum to at most `widest`, which is why the ends have to be measured across
   * the column rather than per pattern: `[_, True, ...rest]` and
   * `[...rest, False, _]` carry two slots each, so `widest + 1` is 3 — but
   * between them they pin three positions, and at length 3 they would be read
   * as pinning the same middle one.
   *
   * That last head is sound because no pattern in this column distinguishes two
   * lengths at or above `bound`. At any length `n ≥ bound` every arm's front
   * region ends by `maxFront` and its back region starts at `n - maxBack`, so
   * the window `[maxFront, n - maxBack)` is constrained by no arm at all — and
   * `bound ≥ maxFront + maxBack` is exactly what makes that window non-empty.
   * Delete elements from it in an uncovered value of length `n > bound` and the
   * length-`bound` value that remains is uncovered too: each front slot keeps
   * its index, each back slot keeps its distance from the end, and the
   * fixed-length arms are all shorter than `bound`, so they match neither
   * length. So the head is decided by specializing at `bound` itself, and §7.3
   * prints it at that same shortest length — which is why the witness for
   * fixed-length-only arms is a length (`[_, _, _]` in §3.3's own example)
   * rather than a shape with an ellipsis in it.
   *
   * The signature is complete, so a vector `match` now demands a catch-all only
   * when it really misses one, and the arms below `[...rest]` are dead by the
   * same §7.2 usefulness every other domain answers to.
   */
  #vectorColumn(
    type: VectorMono,
    patterns: readonly Resolved.Pattern[],
  ): CoverageColumn {
    let widest = 0;
    let maxFront = 0;
    let maxBack = 0;
    for (const pattern of patterns) {
      if (pattern.kind !== "Vector") continue;
      widest = Math.max(widest, pattern.elements.length);
      const rest = pattern.rest;
      if (rest === undefined) continue;
      // §3.1: `rest.index` is the count of slots written before the rest, and
      // the slots written after it count from the end.
      maxFront = Math.max(maxFront, rest.index);
      maxBack = Math.max(maxBack, pattern.elements.length - rest.index);
    }
    const bound = Math.max(widest + 1, maxFront + maxBack);
    const lengthHead = (length: number, key: string): CoverageHead => ({
      key,
      slots: Array.from({ length }, () => type.element),
      print: (witnesses) => `[${witnesses.join(", ")}]`,
    });
    const fixed = new Map<number, CoverageHead>(
      Array.from({ length: bound }, (_, length) => [
        length,
        lengthHead(length, `vector:${length}`),
      ]),
    );
    const variadic = lengthHead(bound, `vector:${bound}+`);
    const signature = [...fixed.values(), variadic];
    return {
      signature,
      split: (pattern) => {
        if (pattern.kind === "Wildcard" || pattern.kind === "Binding") {
          return undefined;
        }
        if (pattern.kind !== "Vector") return distinctHead(pattern);
        const rest = pattern.rest;
        if (rest === undefined) {
          // A fixed pattern is exactly its length, and that length is below
          // `bound` by construction, so it never reaches the variadic head.
          const head = fixed.get(pattern.elements.length);
          return head === undefined
            ? distinctHead(pattern)
            : oneHead(head, vectorSlots(pattern, pattern.elements.length));
        }
        // §3.1: a rest is a binder or anonymous, and either way it says nothing
        // about the middle it covers. A rest that binds a *shape* is outside
        // the form this column models, and takes the head that covers nothing
        // rather than a length claim this matrix cannot check.
        const restShape = rest.pattern === undefined
          ? undefined
          : unwrapAsPattern(rest.pattern).kind;
        if (
          restShape !== undefined && restShape !== "Binding" &&
          restShape !== "Wildcard"
        ) {
          return distinctHead(pattern);
        }
        return {
          heads: signature.filter(
            ({ slots }) => slots.length >= pattern.elements.length,
          ),
          subPatterns: (head) => vectorSlots(pattern, head.slots.length),
        };
      },
    };
  }

  /**
   * A constructor pattern's sub-patterns, padded to the head's arity so an
   * arity error — already reported where the pattern was typed — costs the
   * matrix nothing.
   */
  #alignedSlots(
    pattern: Resolved.ConstructorPattern,
    arity: number,
  ): readonly Resolved.Pattern[] {
    return Array.from(
      { length: arity },
      (_, index) => pattern.arguments[index] ?? wildcardAt(pattern.span),
    );
  }

  /** Maranget's S(c, P): the rows that can still match once `head` is known. */
  #specializeMatrix(
    column: CoverageColumn,
    head: CoverageHead,
    matrix: readonly (readonly Resolved.Pattern[])[],
  ): readonly (readonly Resolved.Pattern[])[] {
    const rows: (readonly Resolved.Pattern[])[] = [];
    for (const row of matrix) {
      const first = row[0];
      if (first === undefined) continue;
      for (const alternative of coverageAlternatives(first)) {
        const split = column.split(alternative);
        if (split === undefined) {
          rows.push([
            ...wildcardSlots(head.slots.length, alternative.span),
            ...row.slice(1),
          ]);
        } else if (split.heads.some(({ key }) => key === head.key)) {
          rows.push([...split.subPatterns(head), ...row.slice(1)]);
        }
      }
    }
    return rows;
  }

  /** Maranget's D(P): the rows that survive a head no row named. */
  #defaultMatrix(
    column: CoverageColumn,
    matrix: readonly (readonly Resolved.Pattern[])[],
  ): readonly (readonly Resolved.Pattern[])[] {
    const rows: (readonly Resolved.Pattern[])[] = [];
    for (const row of matrix) {
      const first = row[0];
      if (first === undefined) continue;
      for (const alternative of coverageAlternatives(first)) {
        if (column.split(alternative) === undefined) rows.push(row.slice(1));
      }
    }
    return rows;
  }

  /** The head keys a matrix's first column names — Maranget's Σ. */
  #columnHeads(
    column: CoverageColumn,
    matrix: readonly (readonly Resolved.Pattern[])[],
  ): ReadonlySet<string> {
    const present = new Set<string>();
    for (const row of matrix) {
      const first = row[0];
      if (first === undefined) continue;
      for (const alternative of coverageAlternatives(first)) {
        const split = column.split(alternative);
        if (split !== undefined) {
          for (const { key } of split.heads) present.add(key);
        }
      }
    }
    return present;
  }

  /**
   * Pattern Matching §7's algorithm **I**: the values `matrix` leaves uncovered
   * over `types`, each rendered by §7.3 as one witness per column.
   *
   * This is the one algorithm the spec asks for, and every coverage judgment in
   * this checker is a call to it or to `#coverageUseful` beside it:
   * exhaustiveness is this over the unguarded arms, irrefutability is this over
   * the single-row matrix (§5.1), and reachability is usefulness.
   */
  #coverageWitnesses(
    types: readonly Mono[],
    matrix: readonly (readonly Resolved.Pattern[])[],
    limit: number,
  ): readonly CoverageWitness[] {
    if (limit <= 0) return [];
    const first = types[0];
    if (first === undefined) {
      return matrix.length === 0 ? [{ columns: [], routes: [] }] : [];
    }
    const rest = types.slice(1);
    const column = this.#coverageColumn(first, coverageHeadPatterns(matrix));
    const present = this.#columnHeads(column, matrix);
    const signature = column.signature;
    const witnesses: CoverageWitness[] = [];
    if (signature !== undefined && signature.every(({ key }) => present.has(key))) {
      // Every head is named, so nothing is missing *here*: the witnesses, if
      // any, are under one of them.
      for (const head of signature) {
        for (
          const witness of this.#coverageWitnesses(
            [...head.slots, ...rest],
            this.#specializeMatrix(column, head, matrix),
            limit - witnesses.length,
          )
        ) {
          witnesses.push({
            columns: [
              head.print(witness.columns.slice(0, head.slots.length)),
              ...witness.columns.slice(head.slots.length),
            ],
            routes: headRoutes(head, witness.routes),
          });
          if (witnesses.length >= limit) return witnesses;
        }
      }
      return witnesses;
    }
    const tails = this.#coverageWitnesses(
      rest,
      this.#defaultMatrix(column, matrix),
      limit,
    );
    if (tails.length === 0) return [];
    const missing = signature?.filter(({ key }) => !present.has(key)) ?? [];
    // §7.3's "prefer the shallowest witness that is genuinely missing": where
    // no row split this column at all, `_` says everything a named head would
    // and says it one level up.
    const heads: readonly { readonly text: string; readonly route?: RouteNeed }[] =
      present.size === 0 || missing.length === 0
        ? [{ text: "_" }]
        : missing.map((head) => ({
          text: head.print(head.slots.map(() => "_")),
          ...(head.route === undefined ? {} : { route: head.route }),
        }));
    for (const tail of tails) {
      for (const head of heads) {
        witnesses.push({
          columns: [head.text, ...tail.columns],
          routes: head.route === undefined ? tail.routes : [head.route, ...tail.routes],
        });
        if (witnesses.length >= limit) return witnesses;
      }
    }
    return witnesses;
  }

  /**
   * Maranget's **U**: whether `row` matches a value no row of `matrix` does.
   * §7.2's reachability is this over the unguarded arms above.
   */
  #coverageUseful(
    types: readonly Mono[],
    matrix: readonly (readonly Resolved.Pattern[])[],
    row: readonly Resolved.Pattern[],
  ): boolean {
    const first = types[0];
    if (first === undefined) return matrix.length === 0;
    const head = row[0];
    if (head === undefined) return matrix.length === 0;
    const rest = types.slice(1);
    const alternatives = coverageAlternatives(head);
    const column = this.#coverageColumn(first, [
      ...coverageHeadPatterns(matrix),
      ...alternatives,
    ]);
    // An or-pattern is useful when any one of its alternatives is (§2.6: they
    // are tried left to right, and each is a shape of its own).
    return alternatives.some((alternative) => {
      const split = column.split(alternative);
      if (split !== undefined) {
        // A pattern naming several heads at once (the vector's rest form) is
        // useful when it is useful at any one of them — the same reading an
        // or-pattern gets, for the same reason: they are alternative shapes.
        return split.heads.some((head) =>
          this.#coverageUseful(
            [...head.slots, ...rest],
            this.#specializeMatrix(column, head, matrix),
            [...split.subPatterns(head), ...row.slice(1)],
          )
        );
      }
      const present = this.#columnHeads(column, matrix);
      const signature = column.signature;
      if (signature !== undefined && signature.every(({ key }) => present.has(key))) {
        return signature.some((candidate) =>
          this.#coverageUseful(
            [...candidate.slots, ...rest],
            this.#specializeMatrix(column, candidate, matrix),
            [
              ...wildcardSlots(candidate.slots.length, alternative.span),
              ...row.slice(1),
            ],
          )
        );
      }
      return this.#coverageUseful(
        rest,
        this.#defaultMatrix(column, matrix),
        row.slice(1),
      );
    });
  }

  /**
   * Pattern Matching §5.1's judgment, verbatim: "run the exhaustiveness
   * algorithm on the single-row matrix `[p]` against `T`. Irrefutable ⇔
   * exhaustive." There is no second, syntactic test — §10 rejects one by name,
   * and #594 is what one costs.
   */
  #coverageIrrefutable(pattern: Resolved.Pattern, type: Mono): boolean {
    return this.#coverageWitnesses([type], [[pattern]], 1).length === 0;
  }

  /**
   * §5.3's one sentence for the three gated positions — `let`, `for..in`, and
   * lambda parameters — with §7.3's witness in it.
   */
  #checkBindingPattern(pattern: Resolved.Pattern, type: Mono): void {
    if (pattern.kind === "Wildcard" || pattern.kind === "Binding") return;
    const found = this.#coverageWitnesses([type], [[pattern]], 1)[0];
    const witness = found?.columns[0];
    if (found === undefined || witness === undefined) return;
    this.#diagnostics.add({
      severity: "error",
      // §7.3: "where a seat's message already carries its own trailing fixit
      // (the lambda-parameter gate's §6.7 line), the route clause stands before
      // that fixit."
      message: `this pattern can fail: \`${witness}\`; use \`match\`` +
        this.#routeClauses(found.routes) +
        this.#matchFunctionFixit(),
      primary: pattern.span,
    });
  }

  /**
   * §7.1's report, once per `match` that leaves values uncovered, with §7.3's
   * witnesses: "up to a small cap (say 3) then '…and N more'".
   *
   * Guarded arms are absent from the matrix, which is §7.1's "guarded arms
   * contribute nothing — including `when True`" as a construction rather than a
   * rule applied afterwards.
   */
  #reportMissingCases(
    arms: readonly Resolved.MatchArm[],
    type: Mono,
    span: Source.Span,
  ): void {
    const witnesses = this.#coverageWitnesses(
      [type],
      arms.flatMap((arm) => arm.guard === undefined ? [[arm.pattern]] : []),
      COVERAGE_WITNESS_LIMIT,
    ).flatMap((witness) =>
      witness.columns[0] === undefined
        ? []
        : [{ text: witness.columns[0], routes: witness.routes }]
    );
    if (witnesses.length === 0) return;
    const listed = witnesses.slice(0, COVERAGE_WITNESSES_SHOWN);
    const shown = listed.map(({ text }) => `\`${text}\``).join(", ");
    const remaining = witnesses.length - COVERAGE_WITNESSES_SHOWN;
    this.#diagnostics.add({
      severity: "error",
      message: `match is missing cases: ${shown}` +
        (remaining > 0 ? ` …and ${remaining} more` : "") +
        // The cap decides what routes: the tail names no constructors (§7.3).
        this.#routeClauses(listed.flatMap(({ routes }) => routes)),
      primary: span,
    });
  }

  /**
   * §7.2's reachability, in both arm seats: an arm is unreachable when its
   * pattern is useless against the **unguarded** arms above it (a guarded arm
   * cannot subsume — its guard may fail), and an or-alternative is unreachable
   * when it is useless against everything above it, its own arm's earlier
   * alternatives included.
   */
  #checkArmReachability(
    arms: readonly Resolved.MatchArm[],
    type: Mono,
    reports: ReachabilityReports,
  ): void {
    const covering: (readonly Resolved.Pattern[])[] = [];
    let shadowed = false;
    for (const arm of arms) {
      const reached: (readonly Resolved.Pattern[])[] = [];
      for (const alternative of coverageAlternatives(arm.pattern)) {
        const above = [...covering, ...reached];
        if (!this.#coverageUseful([type], above, [alternative])) {
          this.#reportUnreachableArm(arm, alternative, shadowed, above, type, reports);
        }
        // §7.3 takes the dual here: "an arm is dead only if it stays dead under
        // every repair, so a broken pattern is never a shadower". The maximal
        // cover granted to a broken pattern is for the coverage judgments; let
        // it into this matrix and a mistyped arm would kill — as hard errors,
        // with a fixit telling the reader to delete them — the good arms below
        // it. The arm *under test* still reads as `_`, which is exactly "is
        // some repair of it useful", so a genuine catch-all above still
        // shadows a broken arm below.
        if (!this.#patternIsBroken(alternative)) reached.push([alternative]);
      }
      if (arm.guard !== undefined) continue;
      covering.push(...reached);
      if (this.#patternIsBroken(arm.pattern)) continue;
      shadowed ||= this.#coverageIrrefutable(arm.pattern, type);
    }
  }

  /** Whether anything inside this pattern failed to type (§7.3's obligation). */
  #patternIsBroken(pattern: Resolved.Pattern): boolean {
    return this.#brokenPatterns.size > 0 &&
      resolvedPatternNodes(pattern).some((node) => this.#brokenPatterns.has(node));
  }

  /**
   * Which of §7.2's sentences an unreachable arm draws. The matrix knows the
   * arm is dead; these three readings are what can honestly be said about *why*.
   */
  #reportUnreachableArm(
    arm: Resolved.MatchArm,
    alternative: Resolved.Pattern,
    shadowed: boolean,
    above: readonly (readonly Resolved.Pattern[])[],
    type: Mono,
    reports: ReachabilityReports,
  ): void {
    // An arm behind one that already covers the domain on its own reads as the
    // arm-level defect it is; that report has stood since the flat forms and
    // says the true thing about the shape above it.
    if (shadowed) {
      this.#diagnostics.add({
        severity: "error",
        message: reports.everything,
        primary: reports.armSpan(arm),
      });
      return;
    }
    // Otherwise, a constructor handled above *in full* has a shadower with a
    // name, and §12 asks for the name. Where the arms above cover this one only
    // jointly, or only at some of its slots, naming one of them would be false
    // and the sentence below says what is true instead.
    if (
      alternative.kind === "Constructor" &&
      !this.#coverageUseful([type], above, [{
        ...alternative,
        arguments: alternative.arguments.map(({ span }) => wildcardAt(span)),
      }])
    ) {
      this.#diagnostics.add({
        severity: "error",
        message: reports.constructor(alternative.text),
        primary: alternative.span,
      });
      return;
    }
    this.#diagnostics.add({
      severity: "error",
      message: alternative.kind === "Integer" || alternative.kind === "String"
        ? reports.literal
        : reports.covered,
      primary: alternative.span,
    });
  }

  /**
   * Numeric Literals §5.1's **expected-type lift**: the home an arithmetic
   * operation runs in when its seat wrote one. The gate is two conditions and
   * no more — the expectation prunes to a **concrete** type, and that type
   * carries the operator's own constraint instance. An expectation that is a
   * variable, or a concrete type without the instance (a user nominal honoring
   * `Num` and `Signed` but not `Pow`), lifts nothing and the operation
   * elaborates from its operands alone. *(The example this sentence used to
   * give, `Pow` having no `Rat`, stopped being one at #523.)*
   *
   * `#supportsTarget` reads the instance table, which is the one channel for
   * every subject there is (#344), so the gate is the same question evidence
   * selection will ask.
   */
  #operationHome(
    operator: Resolved.BinaryOperator | "Negate",
    expected: Mono | undefined,
  ): Mono | undefined {
    if (expected === undefined) return undefined;
    const constraint = operator === "Negate" ? "Signed" : liftConstraint(operator);
    if (constraint === undefined) return undefined;
    const target = this.#prune(expected);
    if (target.kind === "Variable" || target.kind === "Error") return undefined;
    return this.#supportsTarget(target, constraint) ? target : undefined;
  }

  #inferBinary(
    expression: Resolved.BinaryExpr,
    level: number,
    expected?: Mono,
  ): Mono {
    if (expression.operator === "Pipe") {
      const call = rewritePipe(expression);
      this.#pipeCalls.set(expression, call);
      return this.#inferExpr(call, level);
    }

    // The written type is the arithmetic's home (Numeric Literals §5.1). The
    // expectation reaches the operands **recursively** — an operand seat of a
    // lifted operation expects the same type — so a whole arithmetic expression
    // runs at its written type: `let r: Rat = (a + b) * c` is `Rat` throughout.
    // Away from the lift the operands take no expectation, exactly as before.
    //
    // `**` is the one heterogeneous operator (#541): `Pow`'s member is
    // `pow(value: a, exponent: Int)`, so the home governs the **base seat
    // only** and the exponent seat is an ordinary written-`Int` seat. §5.1
    // applies *into* it independently, with `Int` as the written face — which
    // is how the right spine of an exponent tower runs at `Int` whatever the
    // base's home (Operators §6.3, Numeric Literals §5.1).
    const home = this.#operationHome(expression.operator, expected);
    const exponentSeat = expression.operator === "Power";
    const left = this.#inferExpr(expression.left, level, home);
    const right = this.#inferExpr(
      expression.right,
      level,
      exponentSeat ? primitive("Int") : home,
    );

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
    // One source of truth for the operator's constraint, shared with the lift's
    // gate: `Concat` is the only operator left here that names no arithmetic
    // algebra, the logical four and `Range` having returned above.
    const constraint: Typed.ConstraintName =
      liftConstraint(expression.operator) ?? "Concat";
    if (exponentSeat) {
      // The exponent is checked at `Int` and takes no part in the common type
      // (Operators §6.3): the instance subject is the **left** operand alone,
      // selected from it where no expectation lands and from the written face
      // where one does. One operand, so there is no widening race to run.
      this.#checkExponent(expression.right, right, home ?? left);
      let base = left;
      if (home !== undefined) {
        this.#unifyExpected(home, left, expression.left, expression.span, true);
        base = home;
      }
      const power = this.#require(constraint, base, expression.span);
      this.#requirements.set(expression, [power]);
      return base;
    }
    let common = left;
    if (home !== undefined) {
      // The home **is** the common type: each operand reaches it by exact
      // unification or by §5.1's two conversions, each converted once, and the
      // operation's evidence is selected at it. Operand-driven selection is the
      // no-expectation case below.
      this.#unifyExpected(home, left, expression.left, expression.span, true);
      this.#unifyExpected(home, right, expression.right, expression.span, true);
      common = home;
    } else if (
      this.#tryWidenNumeric(expression.left, left, right, expression.span, true)
    ) {
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

  /**
   * `**`'s exponent seat, checked at `Int` *(#541, Operators §6.3; the fixit
   * generalised for #545)*.
   *
   * An ordinary written-`Int` seat: an established `Nat` widens into it through
   * §5.1's conversion, everything else unifies. What the seat adds is the
   * **mandatory fixit**, and since #546 it is a *lookup* rather than a table of
   * two: `pow` at the base's companion, taken only when it is a `widens`
   * binding (Constraints §4.7) whose exponent seat accepts what was offered.
   * The two power doors are then instances of the general answer rather than
   * its content, and a user type that widens its own `pow` is named on exactly
   * the same terms. A base with no such door takes the plain seat error, with
   * no door named — the claim would be false.
   */
  #checkExponent(expression: Resolved.Expr, actual: Mono, base: Mono): void {
    const seat = primitive("Int");
    if (this.#tryWidenNumeric(expression, actual, seat, expression.span)) return;
    // A door is named only where the seat itself cannot answer. An exponent
    // that already reaches `Int` is not a mismatch at all — the widening above
    // handles `Nat`, an `Int` is the seat — and a door accepting it too would
    // otherwise be advertised over a call that is already right.
    const door = this.#acceptsExactly(actual, seat)
      ? undefined
      : this.#exponentDoor(actual, base);
    if (door === undefined) {
      this.#unify(seat, actual, expression.span);
      return;
    }
    const found = this.#prune(actual);
    // Two voices, because the offer names two different faults. `Float` is the
    // one numeric type whose values are the *fractional* exponents `**` cannot
    // take, so at that offer the door is what a fraction wants; at every other
    // offer the exponent's own type is the whole story.
    const offer = found.kind === "Constructor" && found.name === "Float"
      ? `for a fractional exponent at \`${this.#display(base)}\``
      : `for a \`${this.#display(found)}\` exponent`;
    this.#diagnostics.add({
      severity: "error",
      message:
        `the exponent of \`**\` is an \`Int\`; ${offer}, use ` +
        `\`${door}.pow(value, exponent)\``,
      primary: expression.span,
    });
  }

  /**
   * The qualified home of a `widens Pow.pow` at `base` whose exponent seat
   * accepts `offered`, or `undefined` if there is none (#545).
   */
  #exponentDoor(offered: Mono, base: Mono): string | undefined {
    const companion = this.#companionKeyOfType(this.#prune(base));
    const operation = companion === undefined
      ? undefined
      : this.#companionOperations.get(companion)?.get("pow");
    if (operation?.widens !== true) return undefined;
    const scheme = this.#schemes.get(operation.id);
    if (scheme === undefined) return undefined;
    const door = this.#prune(
      this.#instantiate(scheme, 0, undefined, operation.bindingSpan),
    );
    if (door.kind !== "Function") return undefined;
    const exponent = door.parameters[1];
    if (exponent === undefined || !this.#acceptsExactly(offered, exponent)) {
      return undefined;
    }
    return this.#display(this.#prune(base));
  }

  /**
   * The bookkeeping one call's argument checking carries, so that the **first
   * pass** of it can run before the second elaborates *(#513, #517)*.
   *
   * The sweep itself is unchanged — index order, then the two deferred
   * numeric/literal classes. What the schedule adds is `establishFirstPass`:
   * once every non-lambda argument has elaborated, they are checked against
   * their parameters, so a callback *anywhere* in the list reads its expected
   * type off an instantiation the first pass has already resolved (§4.3).
   * `Seq.map(xs, match …)` resolves `a` from `xs` and hands the arms `Int`;
   * so does the callback-first `apply(match …, xs)`.
   */
  #argumentPass(
    parameters: readonly Mono[],
    actuals: readonly Mono[],
    expressions: readonly Resolved.Expr[],
    span: Source.Span,
  ): ArgumentPass {
    // A later argument may establish the shared type of an earlier Nat/Int argument
    // (`plus(count, 1.5)`). Bare literals and fresh variables establish nothing,
    // so defer both classes until concrete/already-constrained arguments settle.
    const deferredNumericArguments: number[] = [];
    const deferredLiteralArguments: number[] = [];
    const establishedVariables = new Set<number>();
    // Every index is dispositioned exactly once — unified, or filed to the
    // class it belongs to. The two entry points partition the arguments
    // between them, and `finish` re-asks about anything the first pass left.
    const disposed = new Set<number>();

    // Which deferred class an argument belongs to, or `undefined` for one the
    // sweep unifies on the spot. Classification is a *question*, asked without
    // filing anything: `establishFirstPass` needs the answer to decide whether
    // it may proceed, and an argument it declines must still arrive at `finish`
    // undispositioned — asked again there, at the moment the unsplit sweep would
    // have asked, since a destination it saw as a variable may have been solved
    // in between.
    const deferral = (index: number): "literal" | "numeric" | undefined => {
      const source = this.#prune(actuals[index] ?? ERROR);
      const destination = this.#prune(parameters[index] ?? ERROR);
      if (destination.kind !== "Variable") return undefined;
      if (source.kind === "Variable" && source.literalOnly) return "literal";
      if (source.kind === "Constructor" && ["Nat", "Int"].includes(source.name)) {
        return "numeric";
      }
      return undefined;
    };

    // One index of the eager sweep, dispositioned exactly once: unified here, or
    // filed to the class it belongs to. `disposed` is what makes that "once" —
    // a double filing is invisible while the unification succeeds and reports
    // the same mismatch once per copy when it does not.
    const eager = (index: number): void => {
      if (disposed.has(index)) return;
      const actual = actuals[index] ?? ERROR;
      const expected = parameters[index] ?? ERROR;
      const expression = expressions[index];
      if (expression === undefined) return;
      disposed.add(index);
      const filed = deferral(index);
      if (filed === "literal") {
        deferredLiteralArguments.push(index);
        return;
      }
      if (filed === "numeric") {
        deferredNumericArguments.push(index);
        return;
      }
      const source = this.#prune(actual);
      const independentlyEstablished = source.kind !== "Variable" ||
        this.#supportsNumericTarget(source, true);
      this.#unifyExpected(expected, actual, expression, span, true);
      const established = this.#prune(expected);
      if (independentlyEstablished && established.kind === "Variable") {
        establishedVariables.add(established.id);
      }
    };

    return {
      establishFirstPass: (deferredLambdas: ReadonlySet<number>): void => {
        for (let index = 0; index < actuals.length; index += 1) {
          // The second pass's own arguments have not elaborated yet; their
          // turn comes at `finish`.
          if (deferredLambdas.has(index)) continue;
          // Skips — never *decides* — an argument that is not already
          // concrete. One still sitting on an unsolved variable establishes
          // nothing (the sweep's own `independentlyEstablished` test says so),
          // and unifying it here would decide it from the parameter rather than
          // letting the second pass's lambda body decide it: `g(p, x =>
          // useInt(p))` at `g : (Float, (Int) -> String) -> …` types `p` at
          // `Int` through the callback and widens the first argument, and it
          // must keep doing so.
          const actual = actuals[index];
          if (actual === undefined || this.#prune(actual).kind === "Variable") continue;
          // A deferred numeric or literal argument is left where it stands,
          // unfiled: it establishes nothing for the callback either, and its
          // destination may still be solved before `finish` asks again.
          if (deferral(index) !== undefined) continue;
          eager(index);
        }
      },
      resolveInstantiation: (
        deferredLambdas: ReadonlySet<number>,
      ): ReadonlySet<number> => {
        const reported = new Set<number>();
        for (let index = 0; index < actuals.length; index += 1) {
          if (deferredLambdas.has(index)) continue;
          const actual = actuals[index];
          if (actual === undefined) continue;
          const source = this.#prune(actual);
          // Establishes nothing, exactly as in `establishFirstPass`.
          if (source.kind === "Variable") continue;
          // **`Nat` and `Int` are the only sources §5.1 converts**, so they are
          // the only ones whose check could record a conversion. A dot call's
          // authority is the whole-signature unification below, which sees the
          // *inferred* type and not the conversion, so an argument that could
          // convert is left entirely to it. Nothing is lost: against a variable
          // destination such an argument is already the deferred numeric class,
          // and against any other it resolves no instantiation.
          if (source.kind === "Constructor" && ["Nat", "Int"].includes(source.name)) {
            continue;
          }
          if (deferral(index) !== undefined) continue;
          const before = this.#diagnostics.count;
          eager(index);
          if (this.#diagnostics.count !== before) reported.add(index);
        }
        return reported;
      },
      finish: (): void => {
        // The eager sweep in index order, skipping what the first pass already
        // dispositioned: every index is dispositioned by exactly one of the
        // two, and the order among those the first pass left is the order the
        // unsplit sweep saw.
        for (let index = 0; index < actuals.length; index += 1) eager(index);
        this.#checkDeferredArguments(
          parameters,
          actuals,
          expressions,
          span,
          deferredNumericArguments,
          deferredLiteralArguments,
          establishedVariables,
        );
      },
    };
  }

  #checkCallArguments(
    parameters: readonly Mono[],
    arguments_: readonly Mono[],
    expressions: readonly Resolved.Expr[],
    span: Source.Span,
  ): void {
    this.#argumentPass(parameters, arguments_, expressions, span).finish();
  }

  #checkDeferredArguments(
    parameters: readonly Mono[],
    arguments_: readonly Mono[],
    expressions: readonly Resolved.Expr[],
    span: Source.Span,
    deferredNumericArguments: readonly number[],
    deferredLiteralArguments: readonly number[],
    establishedVariables: ReadonlySet<number>,
  ): void {
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

  /* --- #355's effect engine ------------------------------------------ */

  /**
   * What a written arrow denotes. `->` is the pure constant and needs no slot;
   * `->!` is the impure constant; `->?` is this signature's shared variable —
   * and where there is no signature to share, it is an **error** rather than a
   * second reading (§2.2.1, §4.4; #405 withdrew the else-constant rule).
   */
  /**
   * The colour a call applies, read off the callee when the callee is already
   * known to be a function and minted fresh when it is not.
   *
   * The bare-call path has always done this by structure — its known-callee
   * branch reads `knownCallee.effect` and its unknown branch mints — and a dot
   * call has to agree, because Method Syntax makes the two spellings the same
   * call. Minting unconditionally here would allocate one variable the bare
   * spelling does not, and a variable id reaches the emitted text through the
   * generated dictionary names, so the two spellings would emit different
   * programs for the same call.
   */
  #calleeEffect(callee: Mono, level: number): Mono {
    const known = this.#prune(callee);
    if (known.kind !== "Function") return this.#fresh(level, false);
    return known.effect ?? PURE;
  }

  #writtenEffect(
    written: "linked" | "constant" | undefined,
    arrowSpan: Source.Span | undefined,
  ): Mono | undefined {
    if (written === undefined) return undefined;
    if (written === "constant") return IMPURE;
    const face = this.#signatureFace;
    if (face === undefined) {
      this.#reportOrphanedLinkedArrow(arrowSpan);
      // Recovery is the impure constant — the colour the writer of a data field
      // or an inlet-less face nearly always meant, and the one that keeps the
      // rest of the body checkable. It is recovery, not a reading: the
      // diagnostic above is the ruling, and `RECOVERED` is how the obligations
      // this colour goes on to feed know not to re-litigate it (§4.4).
      return RECOVERED;
    }
    if (arrowSpan !== undefined) face.arrows.push(arrowSpan);
    return face.effect;
  }

  /** Effects §4.4: a `->?` in a position with no caller to choose its colour. */
  #reportOrphanedLinkedArrow(arrowSpan: Source.Span | undefined): void {
    if (arrowSpan === undefined) return;
    // The alias arm is the resolver's, reported at the declaration before the
    // body is inlined into any use site (Declarations Preamble §5.1.1). By the
    // time an alias body reaches here it has already been condemned once, and
    // this position is only re-elaborating it to publish the type.
    if (this.#linkedArrowPosition === "alias") return;
    // One arrow, one report: a record's fields are elaborated for checking and
    // again for publication, and the writer owes the defect one reading. The
    // key spans **offsets**, not the `Position` objects — stringifying those
    // gives every arrow in a file the same `[object Object]` key, which turns
    // the dedupe into a per-file latch and hides every offence after the first.
    const key = `${Number(arrowSpan.fileId)}:${arrowSpan.start.offset}:${arrowSpan.end.offset}`;
    if (this.#reportedLinkedArrows.has(key)) return;
    this.#reportedLinkedArrows.add(key);
    const because = {
      record: "a `record` field is data, not a signature",
      union: "a `union` field is data, not a signature",
      signature:
        "nothing a caller of this signature supplies carries `->?`, so nothing instantiates it",
      "no-signature": "this annotation is not part of a function signature",
    }[this.#linkedArrowPosition];
    this.#diagnostics.add({
      severity: "error",
      message:
        "`->?` is the caller's colour, and this position has no caller to choose it — " +
        because +
        "; write `->!` for a function that pulls the world, or `->` for one that does not",
      primary: arrowSpan,
      fixes: [{
        message: "write `->!`",
        edits: [{ span: arrowSpan, replacement: "->!" }],
      }],
    });
  }

  /**
   * FFI Part 4 §4.5 (#409): a `conduit` claim on a row with no `->?` anywhere in
   * its signature. The claim is that the row's colour *is* its callbacks', and a
   * row declaring no linked slot has none to take — so it is a diagnostic rather
   * than a silent re-read, on §4.1's and §4.4's own sentence: one spelling, one
   * meaning, and where the meaning is unavailable, a report.
   *
   * The advice is in words rather than a fixit. The two repairs are dropping the
   * claim and marking a callback parameter `->?`, and which one is right is the
   * design conversation the report exists to start — the same reason §4.2's
   * declaration-form branch gives its advice in words when there is no arrow to
   * rewrite.
   */
  #reportUnlinkedConduit(claim: Source.Span): void {
    this.#diagnostics.add({
      severity: "error",
      message:
        "`conduit` claims this row is exactly as effectful as its callbacks, and " +
        "this signature has no `->?` slot to take that colour from — write `->?` " +
        "on the callback parameter this row runs, or drop the claim and take the " +
        "impure default",
      primary: claim,
    });
  }

  /**
   * Elaborates one binding annotation under the §4.4 position its **shape**
   * selects (§2.2.2's second boundary).
   *
   * The clause split is shape and doctrine rather than position: a binding
   * annotation that is itself a **function type** is a signature wherever it
   * stands, so an inlet-less one takes §2.2.1's signature clause even at module
   * level — the writer wrote a signature, and what it lacks is an inlet. A `->?`
   * inside a non-function-type annotation with no enclosing signature — a
   * module-level record-type binding — has no signature to lack one, and takes
   * the no-signature clause. Inside a body neither branch is reached for an
   * inlet-less annotation: it borrows the enclosing colour and there is nothing
   * to refuse.
   *
   * This selects the *clause*, not the scope: whether the annotation opens a
   * signature is `signatureInlet`'s question, above, and a function-typed
   * annotation with no inlet still borrows rather than quantifying.
   *
   * A non-function-type annotation changes nothing and says so by leaving the
   * position in force: module level is already `"no-signature"`, and inside a
   * body the enclosing signature is the one that lacks an inlet.
   */
  #inAnnotationPosition<T>(annotation: Resolved.TypeAnnotation, body: () => T): T {
    return annotation.kind === "Function"
      ? this.#inPosition("signature", body)
      : body();
  }

  /** Runs `body` with §4.4's position set, restoring whatever was in force. */
  #inPosition<T>(
    position: "record" | "union" | "alias" | "signature" | "no-signature",
    body: () => T,
  ): T {
    const previous = this.#linkedArrowPosition;
    this.#linkedArrowPosition = position;
    try {
      return body();
    } finally {
      this.#linkedArrowPosition = previous;
    }
  }

  /**
   * Enters a signature scope, returning what `#closeSignature` must restore.
   *
   * `"open"` mints this signature's shared colour. `"clear"` is a signature of
   * its own with nothing in parameter position to link to, so a `->?` written
   * inside it is §4.4's error rather than a constant. `"inherit"`
   * is for a form that is *not* a second signature: a lambda whose colour a
   * binding annotation already wrote is that annotation's signature, and giving
   * it a scope of its own would mint a second variable for one `->?` and report
   * one defect twice.
   */
  #openSignature(
    mode: "open" | "clear" | "inherit",
    level: number,
    declaration: Source.Span,
  ): SignatureFace | undefined {
    const previous = this.#signatureFace;
    if (mode === "inherit") return previous;
    this.#signatureFace = mode === "open"
      ? { effect: this.#fresh(level, false), arrows: [], declaration }
      : undefined;
    if (this.#signatureFace !== undefined) this.#signatureFaces.push(this.#signatureFace);
    return previous;
  }

  #closeSignature(previous: SignatureFace | undefined): void {
    this.#signatureFace = previous;
  }

  /**
   * Records `enclosing ⊒ colour` for a call written in the current body, and
   * the mark obligation the same call owes. Both are settled after inference:
   * a colour is not yet solved where the call is written, and the join a body
   * computes is not a unification until every call in it is known.
   */
  #registerCall(
    expression: Resolved.CallExpr,
    effect: Mono,
    callee: string,
  ): void {
    const frame = this.#callFrames.has(expression)
      ? this.#callFrames.get(expression)
      : this.#effectFrames.at(-1);
    frame?.absorbed.push({ effect, span: expression.span });
    this.#markObligations.push({
      effect,
      mark: expression.mark,
      markSpan: expression.markSpan,
      insertAt: {
        ...expression.callee.span,
        start: expression.callee.span.end,
      },
      span: expression.span,
      frame,
      callee,
    });
  }

  /**
   * The post-pass: absorb, default, then read every mark off the colour it
   * finally has. Runs once, after all inference and before any scheme is
   * externalised, so an exported face carries the colour its body proved.
   */
  /**
   * One body's colour, decided the moment the body closes: absorb what it
   * calls, then default what nothing constrained.
   */
  #settleFrame(frame: EffectFrame): void {
    // Constants first: they are the only thing that can *force* a colour, and a
    // forced `own` then satisfies every remaining `⊒` outright — which is what
    // keeps a `->!` face from constantifying the callback it forwards.
    for (const { effect, span } of frame.absorbed) {
      const absorbed = this.#prune(effect);
      if (!isImpure(absorbed)) continue;
      frame.sourced = true;
      const own = this.#prune(frame.own);
      if (isImpure(own)) continue;
      if (own.kind === "Effect") {
        // §4.4's recovery is scaffolding, not a claim: a call impure only
        // because a refused `->?` recovered as the constant has already been
        // ruled on, and this face report would be the same defect told twice.
        if (!isRecovered(absorbed)) {
          this.#diagnostics.add({
            severity: "error",
            message:
              "this call performs effects, and the enclosing function's face is the " +
              "pure arrow `->` — a pure face cannot run effects",
            primary: span,
          });
        }
        continue;
      }
      this.#unify(frame.own, absorbed, span);
    }
    // Then the conduits. A body is at least as effectful as anything it
    // calls, and with two points and no subtyping the join is unification —
    // which is also how one variable per signature emerges rather than being
    // imposed.
    for (const { effect, span } of frame.absorbed) {
      const colour = this.#prune(effect);
      if (colour.kind === "Effect") continue;
      if (isImpure(this.#prune(frame.own))) continue;
      this.#unify(frame.own, colour, span);
    }
    // The defaulting clause. A colour this body owns, with no inlet to make it
    // a conduit and nothing to make it a source, is unconstrained — and pure
    // instantiates anywhere, so pure is the harmless answer.
    const own = this.#prune(frame.own);
    if (own.kind === "Variable" && !frame.inlet && !this.#ownedByEnclosing(frame, own)) {
      own.instance = PURE;
    }
  }

  /** The reports, once every body has closed and every colour is final. */
  #settleEffects(): void {
    this.#checkConstantFaces();
    this.#checkSignatureFaces();
    this.#checkMarks();
  }

  /**
   * Whether a call's colour is one of the signature variables a face report has
   * already condemned — followed along the binding chain, since absorption is
   * what turned the variable into the constant being complained about.
   */
  #namesReportedFace(effect: Mono): boolean {
    for (let node: Mono | undefined = effect; node !== undefined;) {
      if (node.kind !== "Variable") return false;
      if (this.#reportedFaces.has(node)) return true;
      node = node.instance;
    }
    return false;
  }

  /** Whether a settled colour belongs to a frame further out than this one. */
  #ownedByEnclosing(frame: EffectFrame, colour: Mono): boolean {
    for (let outer = frame.enclosing; outer !== undefined; outer = outer.enclosing) {
      if (this.#prune(outer.own) === colour) return true;
    }
    return false;
  }

  /** Ruling 7, at every written call: the mark is a function of the solved colour. */
  #checkMarks(): void {
    for (const obligation of this.#markObligations) {
      const colour = this.#prune(obligation.effect);
      // §4.4: a call whose colour is only impure because a refused `->?`
      // recovered as the constant owes no mark report — the recovery is
      // scaffolding, and the mark it would demand is a consequence of the
      // ruling already made, not a second defect. Left in, this is the report
      // that is affirmatively false about the program the writer wrote.
      if (isRecovered(colour)) continue;
      let required: "bang" | "question" | undefined;
      if (colour.kind === "Effect") {
        required = colour.impure ? "bang" : undefined;
      } else if (obligation.frame?.inlet === true) {
        required = "question";
      } else {
        // The defaulting clause again, at a call this body never linked to an
        // inlet: unconstrained, so pure.
        if (colour.kind === "Variable") colour.instance = PURE;
        required = undefined;
      }
      if (required === obligation.mark) continue;
      // A call whose colour *is* a signature variable the face report has
      // already condemned is the same defect told twice: the face is what went
      // wrong, and the marks in the body follow from it.
      if (this.#namesReportedFace(obligation.effect)) continue;
      this.#diagnostics.add({
        severity: "error",
        message: markMessage(obligation.callee, obligation.mark, required),
        primary: obligation.markSpan ?? obligation.span,
        fixes: [{
          message: markFixMessage(required),
          edits: [
            obligation.markSpan === undefined
              ? { span: obligation.insertAt, replacement: markSpelling(required) }
              : { span: obligation.markSpan, replacement: markSpelling(required) },
          ],
        }],
      });
    }
  }

  /**
   * Ruling 9's first half, and ruling 7 lifted to the face: a signature that
   * spells `->?` promises a colour its caller chooses, and a body that solves it
   * to a constant has falsified that promise.
   */
  #checkSignatureFaces(): void {
    for (const face of this.#signatureFaces) {
      const colour = this.#prune(face.effect);
      if (colour.kind !== "Effect") continue;
      // §4.4's recovery again: a face constantified by scaffolding has already
      // been reported at the arrow that was refused.
      if (isRecovered(colour)) continue;
      this.#reportedFaces.add(face.effect);
      // §4.2: the report stands at a written `->?`, not presumptively at the
      // outer arrow — the constantified variable may be spelled only on a
      // nested one, while the outer arrow is honestly `->` or `->!`. A
      // signature with nothing written to rewrite (a declaration form, whose
      // outer arrow has no seat) gets the advice in words instead.
      const written = this.#writtenArrows(face);
      const target = face.outer ?? written[0] ?? face.declaration;
      const rewritable = written.length > 0;
      const replacement = colour.impure ? "->!" : "->";
      // **The impure direction's fixit is the join** (§2.4). Where the outer
      // arrow is one of the written `->?`s, the honest repair is the outer arrow
      // alone: the inlets keep their `->?` and re-link as the constant-outer
      // signature's variable — `withTransaction`'s face exactly — and rewriting
      // them too would refuse the pure callbacks the join exists to keep. Only
      // where the outer arrow is not written is the nested spelling the whole of
      // the condemned colour. The pure direction has no join to preserve, so it
      // rewrites every occurrence.
      const edits = colour.impure && face.outer !== undefined ? [face.outer] : written;
      this.#diagnostics.add({
        severity: "error",
        message: colour.impure
          ? "this signature's `->?` promises a colour the caller chooses, but the body " +
            "solves it to the impure constant — a function that performs its own " +
            "unconditional effects rounds up, and its face is `->!`" +
            (rewritable ? "" : "; give the binding an explicit `(…) ->! …` face")
          : "this signature's `->?` promises a colour the caller chooses, but the body " +
            "solves it to the pure constant — the honest face is `->`",
        primary: target,
        ...(rewritable
          ? {
            fixes: [{
              message: colour.impure ? "write `->!`" : "write `->`",
              edits: edits.map((span) => ({ span, replacement })),
            }],
          }
          : {}),
      });
    }
  }

  /**
   * Every written `->?` that spells one signature's colour, in source order and
   * once each — the pure direction's fixit, and the impure direction's wherever
   * the outer arrow is not among them (§4.2).
   *
   * One arrow can be collected twice — a binding annotation and the lambda under
   * it write the same signature, and a record type is elaborated for checking
   * and again for publication — so the key is the span's own offsets, exactly as
   * §4.4's dedupe keys it. Two arrows in one file never share a start.
   */
  #writtenArrows(face: SignatureFace): readonly Source.Span[] {
    const bySpan = new Map<string, Source.Span>();
    for (const span of [...(face.outer === undefined ? [] : [face.outer]), ...face.arrows]) {
      bySpan.set(`${Number(span.fileId)}:${span.start.offset}:${span.end.offset}`, span);
    }
    return [...bySpan.values()].sort((left, right) =>
      Number(left.fileId) - Number(right.fileId) ||
      left.start.offset - right.start.offset
    );
  }

  /** Ruling 9's symmetric half: `->!` claimed where nothing is unconditionally done. */
  #checkConstantFaces(): void {
    for (const { lambda, arrowSpan } of this.#constantFaces) {
      const frame = this.#frameByLambda.get(lambda);
      if (frame === undefined || frame.sourced) continue;
      this.#diagnostics.add({
        severity: "error",
        message:
          "this face is the impure constant `->!`, but the body performs no " +
          "unconditional effect — it is effect-polymorphic, and its face is `->?`",
        primary: arrowSpan,
        fixes: [{
          message: "write `->?`",
          edits: [{ span: arrowSpan, replacement: "->?" }],
        }],
      });
    }
  }

  #fresh(
    level: number,
    literalOnly: boolean,
    rigidName?: string,
    declaredConstraints?: readonly Typed.ConstraintName[],
    ascribedAt?: Source.Span,
  ): Variable {
    const variable: Variable = {
      kind: "Variable",
      id: this.#nextVariable++,
      ...(rigidName === undefined ? {} : { rigidName }),
      ...(declaredConstraints === undefined ? {} : { declaredConstraints }),
      ...(ascribedAt === undefined ? {} : { ascribedAt }),
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

  /**
   * The inferred type published under the **written** signature's namespace
   * qualifiers (FFI Part 7 §2.4 rung 3, §14.3).
   *
   * A qualifier names a *binding*, not a type, so no pass that rewrites types
   * has reason to preserve one; at two seats the published node is therefore the
   * value's rather than the annotation's. An annotated `let` — `let o: Lib.Point
   * = Lib.origin` — unifies two concrete nominal nodes, so neither is rewritten
   * to the other and the binding publishes the one that came out of
   * `Lib.origin`'s instantiated scheme. A **function's return** does the same
   * with its body's type. Everywhere else the annotation is what builds the
   * type: parameter lists, record fields, union payloads, exception payloads and
   * extern rows keep their spellings by construction.
   *
   * **The written qualifier wins outright — it replaces, it does not fill.** An
   * inferred one is a body's or a private helper's internal spelling choice, and
   * publishing it as the module's face would show the author a spelling written
   * at a seat they cannot see: `export fun f(): Row` whose body names `B.Row`
   * publishes bare `Row` and a minted import, never `B.Row`, because the seat's
   * *absence* of a qualifier is the author's spelling too. Rung 3's totality
   * fact closes the rule rather than leaving it best-effort — every exported
   * binding has a complete written signature, so every published seat has an
   * annotation to honour.
   *
   * **Only the qualifier moves.** Handing the annotation's type back wholesale
   * would be a different change — the two are equal only up to substitution, and
   * `#hasNumericWidening` is the standing evidence that they are sometimes not
   * equal at all — so this respells the inferred node and returns everything
   * else untouched. Nothing but the declaration emitter reads the field.
   *
   * The walk is guided by the *written* tree, which is finite, so a recursive
   * type cannot make it diverge; anywhere the two shapes disagree it stops and
   * yields the inferred side unchanged, that being a position the annotation
   * does not publish.
   */
  #applyWrittenQualifiers(written: Mono, inferred: Mono): Mono {
    const source = this.#prune(written);
    const target = this.#prune(inferred);
    if (source.kind !== target.kind) return target;
    if (
      (source.kind === "Union" && target.kind === "Union" && source.union === target.union) ||
      (source.kind === "NominalRecord" && target.kind === "NominalRecord" &&
        source.record === target.record)
    ) {
      const nominal = source as UnionMono | NominalRecordMono;
      // The inferred node's own qualifier is dropped before the written one is
      // put back, which is the whole of "replaces, does not fill": a bare
      // written seat publishes bare.
      const { qualifier: _inferred, ...carried } = target as UnionMono | NominalRecordMono;
      return {
        ...carried,
        arguments: carried.arguments.map((argument, index) =>
          index < nominal.arguments.length
            ? this.#applyWrittenQualifiers(nominal.arguments[index]!, argument)
            : argument
        ),
        ...(nominal.qualifier === undefined ? {} : { qualifier: nominal.qualifier }),
      } as Mono;
    }
    if (
      source.kind === "ExternType" && target.kind === "ExternType" &&
      source.externType === target.externType
    ) {
      const { qualifier: _inferred, ...carried } = target;
      return {
        ...carried,
        ...(source.qualifier === undefined ? {} : { qualifier: source.qualifier }),
      };
    }
    if (source.kind === "Function" && target.kind === "Function") {
      return {
        ...target,
        parameters: target.parameters.map((parameter, index) =>
          index < source.parameters.length
            ? this.#applyWrittenQualifiers(source.parameters[index]!, parameter)
            : parameter
        ),
        result: this.#applyWrittenQualifiers(source.result, target.result),
      };
    }
    // A **structural record** carries nominals in its fields like any other
    // container, and it is the seat this graft exists for one step over:
    // `let r: {p: Lib.Point}` published `{ p: Point }` beside an `f(v:
    // {p: Lib.Point})` publishing `Lib.Point` — one file, two spellings of one
    // identity, and a minted line no answer owed. Matched by field *name*, the
    // row being unordered; a field the written type does not mention is left
    // exactly as inference produced it.
    if (source.kind === "Record" && target.kind === "Record") {
      return {
        ...target,
        fields: new Map(
          [...target.fields].map(([name, field]) => {
            const written = source.fields.get(name);
            return [
              name,
              written === undefined ? field : this.#applyWrittenQualifiers(written, field),
            ] as const;
          }),
        ),
      };
    }
    if (source.kind === "Tuple" && target.kind === "Tuple") {
      return {
        ...target,
        elements: target.elements.map((element, index) =>
          index < source.elements.length
            ? this.#applyWrittenQualifiers(source.elements[index]!, element)
            : element
        ),
      };
    }
    if (
      (source.kind === "Vector" && target.kind === "Vector") ||
      (source.kind === "Set" && target.kind === "Set") ||
      (source.kind === "Array" && target.kind === "Array") ||
      (source.kind === "JsSet" && target.kind === "JsSet") ||
      (source.kind === "Node" && target.kind === "Node")
    ) {
      return { ...target, element: this.#applyWrittenQualifiers(source.element, target.element) };
    }
    if (source.kind === "Nullable" && target.kind === "Nullable") {
      return { ...target, value: this.#applyWrittenQualifiers(source.value, target.value) };
    }
    if (
      (source.kind === "Map" && target.kind === "Map") ||
      (source.kind === "JsMap" && target.kind === "JsMap")
    ) {
      return {
        ...target,
        key: this.#applyWrittenQualifiers(source.key, target.key),
        value: this.#applyWrittenQualifiers(source.value, target.value),
      };
    }
    return target;
  }

  #prune(type: Mono): Mono {
    if (type.kind !== "Variable" || type.instance === undefined) return type;
    type.instance = this.#prune(type.instance);
    return type.instance;
  }

  /**
   * A pattern's own shape unified against what its seat expects, recording the
   * verdict — Pattern Matching §7.3's error-program obligation needs to know
   * which patterns *failed to type*, and this is the only seat that knows.
   *
   * The reading is deliberately narrow: a pattern is broken when the check of
   * its own shape reported, not when a diagnostic merely landed nearby and not
   * when the coverage column later fails to recognize it. Everything else about
   * the pattern still happens — sub-patterns walk, binders exist — because the
   * obligation is about what a *witness* may say, never about abandoning the
   * program (§7.3: "its row's well-typed columns stand as written").
   */
  #unifyPattern(pattern: Resolved.Pattern, expected: Mono, actual: Mono): void {
    // `count` counts diagnostics as *added*, while `toArray` can drop one inside
    // a `supersedes` region. No producer sets `supersedes` today, so the two
    // readings agree; should one ever, a pattern could be granted maximal cover
    // with no surviving diagnostic to explain the silence, and this read is
    // where that would have to become "reported, and still reported".
    const before = this.#diagnostics.count;
    this.#unify(expected, actual, pattern.span);
    if (this.#diagnostics.count > before) this.#brokenPatterns.add(pattern);
  }

  /**
   * A constructor pattern written at the wrong arity — Unions §4.2's sentence,
   * from all three of its seats — and a pattern that **failed to type**.
   *
   * The brokenness matters for §7.2's half of §7.3's obligation rather than for
   * coverage's. An arity-wrong pattern cannot widen a witness's vocabulary: the
   * head is found and `#alignedSlots` pads, so exhaustiveness is unmoved. But it
   * is not dead under every repair either, and left unmarked it *shadows*:
   * `On => 1` above `On(3) => 2` reported the good arm unreachable, with §7.2's
   * "remove the arm or reorder it" advice attached — the exact failure the
   * block's dual forbids.
   */
  #reportPatternArity(
    pattern: Resolved.ConstructorPattern,
    arity: number,
  ): void {
    this.#diagnostics.add({
      severity: "error",
      message: `constructor pattern \`${pattern.text}\` expects ${arity} arguments, got ${pattern.arguments.length}`,
      primary: pattern.span,
    });
    this.#brokenPatterns.add(pattern);
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
    if (actualLeft.kind === "Effect" || actualRight.kind === "Effect") {
      if (
        actualLeft.kind === "Effect" && actualRight.kind === "Effect" &&
        actualLeft.impure === actualRight.impure
      ) {
        return;
      }
      // §4.4: neither direction is owed where one side is the recovery a
      // refused `->?` left behind. The arrow was ruled on at the arrow; the
      // constant standing in for it is scaffolding, and a demand report here
      // would describe a colour the writer never wrote.
      if (isRecovered(actualLeft) || isRecovered(actualRight)) return;
      // The one report the two-point lattice owes. It fires where a `->`
      // demand meets an impure function — `Seq.memoize`'s producer, a pure
      // constraint member, a callback stored in a `->` field — and nowhere
      // else, because every other direction is instantiation.
      this.#diagnostics.add({
        severity: "error",
        message: effectMismatchMessage(actualLeft, actualRight),
        primary: span,
      });
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
      if (actualLeft.effect !== undefined || actualRight.effect !== undefined) {
        // An absent slot is the pure constant, so an inferred function type
        // meets a compiler-synthesized one without either side needing a slot
        // it was never given.
        this.#unify(actualLeft.effect ?? PURE, actualRight.effect ?? PURE, span);
      }
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
    } else if (actualLeft.kind === "JsSet" && actualRight.kind === "JsSet") {
      this.#unify(actualLeft.element, actualRight.element, span);
      return;
    } else if (actualLeft.kind === "JsMap" && actualRight.kind === "JsMap") {
      this.#unify(actualLeft.key, actualRight.key, span);
      this.#unify(actualLeft.value, actualRight.value, span);
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
      message: this.#postFinalisationRedirect(actualLeft, actualRight) ??
        message?.() ??
        `type mismatch: expected ${this.#display(actualLeft)}, found ` +
          this.#display(actualRight),
      primary: span,
    });
  }

  /**
   * §3.6's mandatory enrichment — the worst error this feature can produce, at
   * maximal distance from its cause.
   *
   * A binding whose receiver was never head-known finalises at the row the
   * fallback imposed; the contradiction then surfaces at a *use*, where the
   * naive message ("`Vector` is not a record") says nothing about why the row
   * exists or what to do. The rescue fires whenever the demanded field's name
   * matches an exported companion operation of the failing nominal **or a
   * subject-first member of a constraint honored at it** *(the member clause is
   * 2026-08-07's: `fun f(v) = v.show()` finalised at the row type, then applied
   * to an `Int`, deserves the same rescue)*.
   *
   * Keyed on the name match, not on where the failure surfaced: same module or
   * across the program, the cause and the fixit are identical.
   */
  #postFinalisationRedirect(left: Mono, right: Mono): string | undefined {
    const row = left.kind === "Record" ? left : right.kind === "Record" ? right : undefined;
    const nominal = row === left ? right : left;
    if (row === undefined || row === nominal || row.tail === undefined) return undefined;
    if (nominal.kind === "Record" || nominal.kind === "Variable") return undefined;
    const display = this.#display(nominal);
    for (const name of row.fields.keys()) {
      const companion = this.#companionKeyOfType(nominal);
      const operation = companion === undefined
        ? undefined
        : this.#companionOperations.get(companion)?.get(name);
      const member = (this.#honoredMembers(nominal).get(name) ?? [])
        .find(({ subjectFirst }) => subjectFirst);
      if (operation === undefined && member === undefined) continue;
      return `this value's type was inferred as a record with a \`${name}\` field ` +
        `because its type was unknown where it was written; \`${display}\` is not a ` +
        `record. Annotate it to use dispatch, or call ${
          member === undefined
            // The companion is named by the type's head, never by its display:
            // `Vector.length`, not `Vector(Int).length`, which resolves nowhere.
            ? `\`${companionHeadName(nominal) ?? display}.${name}(…)\` directly`
            : `${this.#memberSpelling(member)} directly`
        }.`;
    }
    return undefined;
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

  #recordMismatch(fields: readonly string[], span: Source.Span): void {
    this.#diagnostics.add({
      severity: "error",
      message: `record fields do not match; unexpected ${fields.map((field) => `\`${field}\``).join(", ")}`,
      primary: span,
    });
  }

  /**
   * Defaulting's proposal of `Int` (Numeric Literals §4), which a declared type
   * variable refuses.
   *
   * For a variable a *binder* declared, refusing is `#bind`'s own rigid arm —
   * Functions §10's forced-to-a-concrete-type row, unchanged. For one an
   * **ascription** declared, that row is worded for this spelling (Ascription
   * §5): no body demanded `Int`, defaulting proposed it, so the report says what
   * the claim got wrong and names this form's rewrites. Both rewrites compile,
   * which is what the Rewrite Rule asks of them.
   */
  #refuseOrDefault(variable: Variable, span: Source.Span): void {
    const literal = variable.ascribedAt === undefined
      ? undefined
      : variable.requirements.find(
          (requirement) => requirement.origin === "literal" && requirement.literal !== undefined,
        );
    if (literal?.literal === undefined) {
      this.#bind(variable, primitive("Int"), span);
      return;
    }
    this.#diagnostics.add({
      severity: "error",
      message:
        `\`${variable.rigidName}\` is a declared type variable, but \`${literal.literal}\` ` +
        `can be only a \`${literal.name}\` type; ascribe the concrete type you mean — ` +
        `\`(${literal.literal} : Int)\` — or remove the ascription to let the literal ` +
        "default to `Int`",
      primary: span,
    });
    for (const requirement of variable.requirements) requirement.reported = true;
    variable.instance = ERROR;
  }

  /**
   * The two members whose declared heads a knot has just asked to be one
   * variable (Functions §7.4), or `undefined` where the collision is any other
   * two annotations'.
   *
   * Both sides must be heads of *different* members of **one** component under
   * check. A single head colliding with a concrete type is the other family —
   * a sibling using the member at an instantiation — and keeps its own message.
   *
   * One component, and the frame walk is what tests it: nesting puts two knots
   * on the stack at once, and a `fun g<b>` written inside `fun f<a>`'s body has
   * both heads live and can unify them (`fun f<a>(x: a): a = fun g<b>(y: b): b =
   * x …`). Those two members share no knot, no recursion links them, and the
   * general message — one name in both annotations — is the apt advice there.
   */
  #knotHeadCollision(
    left: Variable,
    right: Variable,
  ): { readonly knot: Knot; readonly left: HeadSite; readonly right: HeadSite } | undefined {
    const leftOwner = this.#declaredHeadOwners.get(left.id);
    const rightOwner = this.#declaredHeadOwners.get(right.id);
    if (leftOwner === undefined || rightOwner === undefined) return undefined;
    // *(#700.)* One owner is one declaration: two variables of one member's
    // head, or two of one **block** head, are the ordinary two-annotations case
    // and keep the generic message — the block head is a sharing route between
    // members, never between its own binders.
    if (leftOwner === rightOwner) return undefined;
    if (
      leftOwner.kind === "member" && rightOwner.kind === "member" &&
      leftOwner.symbol === rightOwner.symbol
    ) {
      return undefined;
    }
    for (const knot of this.#knots) {
      const leftSite = knotHeadSite(knot, leftOwner);
      const rightSite = knotHeadSite(knot, rightOwner);
      if (leftSite !== undefined && rightSite !== undefined) {
        return { knot, left: leftSite, right: rightSite };
      }
    }
    return undefined;
  }

  #bind(variable: Variable, type: Mono, span: Source.Span): void {
    if (variable.rigidName !== undefined) {
      if (type.kind === "Variable" && type.rigidName === undefined) {
        this.#bind(type, variable, span);
        return;
      }
      if (type.kind === "Variable" && type.rigidName !== undefined) {
        const collision = this.#knotHeadCollision(variable, type);
        if (collision === undefined) {
          this.#diagnostics.add({
            severity: "error",
            message:
              `\`${variable.rigidName}\` and \`${type.rigidName}\` are distinct declared type variables, ` +
              "but the body requires them to be the same; use one type variable name in both " +
              "annotations, or remove an annotation to let the type be inferred",
            primary: span,
          });
        } else if (!collision.knot.refused) {
          // §10 says "the refusal takes the SCC hint", singular: the knot is
          // refused once, however many of its heads the component links, and
          // the group's next collision belongs to a recompile of a program the
          // author has actually repaired. The flag also carries the refusal to
          // `#errorKnotHeads`, which discharges it at the component's end. The
          // heads stay live until then on purpose: a later body forcing one to a
          // concrete type is a demand that body really makes, and it still
          // reports, that message being correct in kind.
          collision.knot.refused = true;
          // A side declared on a block head has no name to quote, so §10 says
          // to locate it by its span — the label is that location (#700).
          const headSpans = [collision.left, collision.right]
            .filter((site) => site.kind === "block")
            .map((site) => site.span);
          this.#diagnostics.add({
            severity: "error",
            message: knotHeadCollisionMessage(
              variable.rigidName,
              type.rigidName,
              collision.left,
              collision.right,
            ),
            primary: span,
            ...(headSpans.length === 0
              ? {}
              : {
                  labels: headSpans.map((headSpan) => ({
                    span: headSpan,
                    message: "declared on this `fun` block head",
                  })),
                }),
          });
        }
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
      // A `var`'s unsolved monotype moves with it: the variable that will be
      // settled is now the other one, and Statements §6.1's ban has to be
      // watching *that* one when the arrow arrives (#700).
      const owner = this.#pinnedVars.get(variable.id);
      if (owner !== undefined) this.#pinnedVars.set(type.id, owner);
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
    // Statements §6.1's other arm (#700): the **pinning use** that settles a
    // `var`'s unsolved monotype to an arrow. The span is the use's, which is
    // where the author can act — the declaration said nothing about functions.
    const pinnedVar = this.#pinnedVars.get(variable.id);
    if (pinnedVar !== undefined && type.kind === "Function") {
      this.#pinnedVars.delete(variable.id);
      this.#diagnostics.add({
        severity: "error",
        message: functionTypedVarMessage(pinnedVar),
        primary: span,
      });
    }
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
      case "JsSet":
      case "Node":
        this.#lowerLevels(actual.element, level);
        return;
      case "Nullable":
        this.#lowerLevels(actual.value, level);
        return;
      case "Map":
      case "JsMap":
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
        this.#occurs(variable, actual.result) ||
        (actual.effect !== undefined && this.#occurs(variable, actual.effect))
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
    if (actual.kind === "JsSet") return this.#occurs(variable, actual.element);
    if (actual.kind === "Node") return this.#occurs(variable, actual.element);
    if (actual.kind === "Nullable") return this.#occurs(variable, actual.value);
    if (actual.kind === "Map" || actual.kind === "JsMap") {
      return this.#occurs(variable, actual.key) || this.#occurs(variable, actual.value);
    }
    return false;
  }

  #require(
    name: Typed.ConstraintName,
    type: Mono,
    span: Source.Span,
    origin: Requirement["origin"] = "operation",
    impliedTypes?: ReadonlyMap<string, Mono>,
    /** Only `#importScheme` passes this; see `Requirement.identity`. */
    identity: string = this.#constraintIdentity(name),
  ): Requirement {
    const demandedBy = this.#annotationOwner;
    const requirement: Requirement = {
      name,
      identity,
      type,
      span,
      origin,
      ...(demandedBy?.kind === "member" ? { demandedBy: demandedBy.name } : {}),
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
        destination.requirements.some(({ identity }) =>
          this.#entailmentPath(identity, this.#constraintIdentity(constraint)) !==
            undefined
        )
      // One channel, for every subject there is (#344): the instance table. A
      // primitive used to answer from a wired row instead, which is why
      // `Rat.fromNat`'s widening into `BigInt` was the first thing to break
      // when the first of those rows retired — and why the widenings into
      // `Float` are the last, arriving here with the last companion.
      : this.#instances.has(this.#instanceKeyFor(constraint, destination));
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

  /**
   * Records one demand on a variable: it joins the list unless a constraint
   * already there entails it, the same-identity duplicate being that test's
   * degenerate case.
   *
   * Entailment is asked of the declarations the two requirements demand and
   * never of their spellings: a requirement copied out of an imported scheme
   * names a constraint this module may not be able to spell, and two that share
   * a word may be unrelated declarations (§5.1.1).
   *
   * Nothing about *routing* is decided here, and deliberately so. A route says
   * which surviving binder a demand projects out of, and the survivors are not
   * known until the list stops growing: a `Num` demand that arrives before the
   * `Signed` that will absorb it would be stamped with no provider at all, and
   * a `Num` stamped through `Signed` is stale the moment a `Frac` arrives and
   * absorbs `Signed` in turn. Every route is derived at the Typed boundary
   * instead, off the final list, by `#keptRequirements`.
   */
  #attachRequirement(variable: Variable, requirement: Requirement): void {
    const entailed = variable.requirements.some(
      (candidate) =>
        this.#entailmentPath(candidate.identity, requirement.identity) !== undefined,
    );
    if (entailed) return;
    variable.requirements.push(requirement);
  }

  /**
   * The requirements of a variable that keep an evidence seat: those maximal
   * under entailment, in list order.
   *
   * The one place the ABI's binder set is decided, so the three readers of it —
   * the published scheme's constraint list, the route a demand publishes, and
   * the binder an exported signature is told to write — cannot disagree about
   * which constraints a caller actually passes. Keyed by *identity*, because two
   * distinct constraints can share a name (see `#canonicalConstraintName`) and
   * neither absorbs the other.
   */
  #keptRequirements(variable: Variable): readonly Requirement[] {
    return variable.requirements.filter((requirement) =>
      !variable.requirements.some((other) =>
        other.identity !== requirement.identity &&
        this.#entailmentPath(other.identity, requirement.identity) !== undefined
      )
    );
  }

  #acceptRequirement(variable: Variable, requirement: Requirement): void {
    const declared = variable.declaredConstraints;
    if (
      declared !== undefined &&
      requirement.origin !== "annotation" &&
      // `declared` is spelled in this module's source, the requirement is not:
      // each side is turned into an identity by its own route.
      !declared.some((constraint) =>
        this.#entailmentPath(
          this.#constraintIdentity(constraint),
          requirement.identity,
        ) !== undefined
      )
    ) {
      // Keyed on the **declaration**, not the word (#716). A third demand for a
      // third `Describe` is a third refusal, and suppressing it on the spelling
      // would drop a report for a constraint nothing else in the family names.
      if (variable.rejectedConstraints.has(requirement.identity)) {
        requirement.reported = true;
        return;
      }
      variable.rejectedConstraints.add(requirement.identity);
      // Maximality between the written list and the demand is a question about
      // declarations (§5.1.1): a same-spelled shadow's bases absorb nothing,
      // because they are not the required declaration's bases (#715). The
      // written side keeps the word the author wrote — it is spellable by
      // construction — and only the required side is spelled by the law.
      const requiredName = this.#canonicalConstraintName(
        requirement.name,
        requirement.identity,
      );
      const spellings = this.#refusalSpellings(declared, requirement, requiredName);
      const constraintList = spellings.length === 1
        ? spellingText(spellings[0]!)
        : `(${spellings.map(spellingText).join(", ")})`;
      // §5.1.1's collision resolution, and only that: the sides qualify when
      // they share a word and not a declaration, and every other report keeps
      // the bare name it always printed.
      const collision = declared.some((constraint) =>
        constraint === requiredName &&
        this.#constraintIdentity(constraint) !== requirement.identity
      );
      const requiredMention = collision
        ? this.#qualifiedConstraintMention(requiredName, requirement.identity)
        : `\`${requirement.name}\``;
      const declaration = declared.length === 0
        ? `\`${variable.rigidName}\` is declared without constraints`
        : `\`${variable.rigidName}\` is declared to honor ${
          this.#formatConstraintNames(declared, collision ? requiredName : undefined)
        }`;
      // §5.1.1's fourth tier: no spelling and no route, so no rewrite. The
      // report names the gate and leaves the seat's own standing exit.
      const sealed = spellings.find((spelling) => spelling.kind === "sealed");
      const sealedDemand = sealed === undefined
        ? ""
        : `${this.#sealedConstraintMention(sealed)}; no constraint list here can name it`;
      // The clause the routed spellings owe. The refusal arms have already named
      // the declaring module in their collision qualification, so the clause
      // drops its "declared in" half (§5.1.1's elision licence); with no
      // collision to qualify, nothing has named it and the clause stands whole.
      const routes = this.#constraintRouteClauses(spellings, !collision);
      // Three binder positions share this rejection, and each names the rewrite
      // that is actually legal at its declaration site — a constraint cannot
      // list itself as a base, and an `honor` binder's constraints are written,
      // never inferred, so the function-binder wording misleads at both.
      if (this.#constraintSubjectVariables.has(variable.id)) {
        const constraint = declared[0]!;
        const bases = this.#subjectBaseSpellings(constraint, requirement, requiredName);
        const baseList = bases.length === 1
          ? spellingText(bases[0]!)
          : `(${bases.map(spellingText).join(", ")})`;
        const head = `\`${variable.rigidName}\` is \`${constraint}\`'s subject, so the body reaches ` +
          `only \`${constraint}\` and its base constraints, but it requires `;
        this.#diagnostics.add({
          severity: "error",
          message: sealed !== undefined
            ? `${head}${sealedDemand}`
            // The "add" clause carries the qualification the sentence has just
            // minted, wherever there is one. Bare, it names the word this very
            // declaration is written under — and the row's own rationale is
            // that a constraint cannot list itself as a base, so the reader is
            // handed a sentence that reads as self-reference. Non-collision
            // messages keep the bare name they always printed.
            : `${head}${requiredMention}; add ${
              collision ? requiredMention : `\`${requiredName}\``
            } as a base constraint — ` +
              `write \`constraint ${constraint}<${variable.rigidName}: ${baseList}>\`` +
              this.#constraintRouteClauses(bases, !collision),
          primary: requirement.span,
        });
        requirement.reported = true;
        return;
      }
      if (this.#honorBinderVariables.has(variable.id)) {
        this.#diagnostics.add({
          severity: "error",
          message: sealed !== undefined
            ? `${declaration}, but the body requires ${sealedDemand}`
            // The seat comes before the clause here, and only here: the seat
            // names *where* the rewrite goes, and a route clause between the
            // two would part the binder from its header.
            : `${declaration}, but the body requires ${requiredMention}; ` +
              `write \`<${variable.rigidName}: ${constraintList}>\` on the \`honor\` header${routes}`,
          primary: requirement.span,
        });
        requirement.reported = true;
        return;
      }
      // *(#700.)* A variable declared on a `fun` **block head** is one list over
      // several members, so the refusal respells to the head and names the
      // member whose body exceeded it. The fused spelling's wording is
      // untouched: this arm keys on the *owner* being a head, which is the same
      // attribution §10's rigid-vs-rigid message qualifies a side by.
      if (this.#declaredHeadOwners.get(variable.id)?.kind === "block") {
        const subject = requirement.demandedBy === undefined
          ? "the body"
          : `\`${requirement.demandedBy}\`'s body`;
        const headRewrite = declared.length === 0
          ? "remove the head's binder to let it be inferred"
          : "remove the head's constraint to let it be inferred";
        this.#diagnostics.add({
          severity: "error",
          message: sealed !== undefined
            ? `${declaration} on the block head, but ${subject} requires ${sealedDemand} — ${headRewrite}`
            : `${declaration} on the block head, but ${subject} requires ` +
              `${requiredMention}; widen the head: ` +
              `\`fun<${variable.rigidName}: ${constraintList}>\`${routes}, or ${headRewrite}`,
          primary: requirement.span,
        });
        requirement.reported = true;
        return;
      }
      const inferenceRewrite = declared.length === 0
        ? "remove the explicit type parameter to let it be inferred"
        : "remove the constraint annotation to let it be inferred";
      this.#diagnostics.add({
        severity: "error",
        message: sealed !== undefined
          ? `${declaration}, but the body requires ${sealedDemand} — ${inferenceRewrite}`
          : `${declaration}, but the body requires ` +
            `${requiredMention}; write \`<${variable.rigidName}: ${constraintList}>\`${routes}, ` +
            `or ${inferenceRewrite}`,
        primary: requirement.span,
      });
      requirement.reported = true;
      return;
    }
    this.#attachRequirement(variable, requirement);
  }

  /**
   * The refusal family's advised list: the written constraints and the demand
   * they do not entail, sieved by **identity** and spelled by §5.1.1's law.
   *
   * The written entries keep the words the author wrote — a spelling in the
   * source resolves here by definition, and respelling it would move the
   * author's own text — so only the demand walks the tiers.
   */
  #refusalSpellings(
    declared: readonly Typed.ConstraintName[],
    requirement: Requirement,
    requiredName: string,
  ): readonly ConstraintSpelling[] {
    return this.#maximalAdvisedSpellings(
      declared.map((constraint) => ({
        written: constraint,
        identity: this.#constraintIdentity(constraint),
      })),
      requirement,
      requiredName,
    );
  }

  /**
   * The same sieve for the subject arm, whose written side is the declaration's
   * **base list** and whose result drops the declaration itself (a constraint
   * cannot list itself as a base).
   */
  #subjectBaseSpellings(
    constraint: string,
    requirement: Requirement,
    requiredName: string,
  ): readonly ConstraintSpelling[] {
    const identity = this.#constraintIdentity(constraint);
    return this.#maximalAdvisedSpellings(
      this.#baseConstraintsOf(identity).map((base) => ({
        written: base.name,
        identity: base.identity,
      })),
      requirement,
      requiredName,
    ).filter((spelling) => spelling.kind !== "spelled" || spelling.text !== constraint);
  }

  /**
   * One advised list: written entries plus the demand, entailment-maximal by
   * identity, deduplicated by identity, in written order with the demand last.
   */
  #maximalAdvisedSpellings(
    written: readonly { readonly written: string; readonly identity: string }[],
    requirement: Requirement,
    requiredName: string,
  ): readonly ConstraintSpelling[] {
    const entries = [
      ...written,
      { written: undefined, identity: requirement.identity },
    ];
    const kept = entries.filter((entry, index) =>
      entries.findIndex(({ identity }) => identity === entry.identity) === index &&
      !entries.some((other) =>
        other.identity !== entry.identity &&
        this.#entailmentPath(other.identity, entry.identity) !== undefined
      )
    );
    const advised = this.#constraintSpellings(
      kept.filter((entry) => entry.written === undefined)
        .map(({ identity }) => ({ name: requiredName, identity })),
    );
    let next = 0;
    return kept.map((entry) =>
      entry.written === undefined
        ? advised[next++]!
        : { kind: "spelled", text: entry.written } as const
    );
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

  /**
   * The written constraint list as a report reads it back.
   *
   * `qualify` names the one word a demand collides with — same spelling, other
   * declaration — and only that word takes §5.1.1's home qualification. Every
   * other entry, and every list asked without one, keeps the bare name: the
   * bullet makes qualification the collision's resolution, never the default.
   */
  #formatConstraintNames(
    constraints: readonly Typed.ConstraintName[],
    qualify?: string,
  ): string {
    return constraints.map((constraint) =>
      constraint === qualify
        ? this.#qualifiedConstraintMention(constraint, this.#constraintIdentity(constraint))
        : `\`${constraint}\``
    ).join(" and ");
  }

  /**
   * §4.2's base-constraint obligations for one instance, as requirements on its
   * subject.
   *
   * Each carries the base's identity as its *declaration* fixed it, not one
   * re-derived from the base's name here: `honor ImportedLoud<Metre>` owes an
   * instance of the `Describe` **alpha** declared, which this module may have no
   * word for at all.
   */
  #instanceBaseRequirements(
    item: Resolved.HonorItem,
    subject: Mono,
  ): readonly Requirement[] {
    return this.#baseConstraintsOf(item.constraintIdentity).map((base) =>
      this.#require(
        base.name,
        subject,
        item.span,
        "operation",
        undefined,
        base.identity,
      )
    );
  }

  /**
   * The refusal for a bare name that no constraint answers for, with the module
   * alias's repairs where one is standing there (Modules §10's row, mirrored
   * from the type-position message the resolver writes).
   *
   * The same-spelled export never reaches here: §5.1 rule 2's companion fallback
   * resolved it, and that branch of the old message is now a resolution. What is
   * left is the alias whose module exports constraints under other spellings —
   * and, exactly as in type position, the **exported inventory drives which
   * repairs are named**: one is the case worth spelling out in full, several
   * make "the constraint it exports" a false singular.
   *
   * With **no alias standing there at all** the refusal carries the family's
   * own signpost instead (#577, Constraints §8's row, in Modules §5.1 rule 1's
   * register): nothing of the spelling is in scope, which is the arrival state
   * of an author who has read §5.3 and not yet written the import, and the two
   * routes that reach a constraint are the import line and the named import.
   * The arm is unreachable at the eleven pre-registered spellings, which always
   * resolve (Constraints §5.1.1) — no case is carved for them, because a carve
   * would be a claim about a branch nothing can enter. It is the **bare**
   * spelling's, though, and only that: a qualified head (`honor D.NotThere<T>`,
   * §4.1's spelling) arrives here under its whole dotted name, whose repair is
   * not an import of a module called `D.NotThere` — that writer already holds an
   * alias, or holds the wrong one, and the plain refusal is what the row names.
   *
   * Returns the message *and the marker*, rather than a string, because the two
   * are one decision: the arm that names `import module` as a repair is exactly
   * the arm whose workspace tier can apply it, and a caller free to attach one
   * without the other could put a fixit on a message that never offered it.
   */
  #unknownConstraint(
    constraint: string,
  ): Pick<Diagnostics.Diagnostic, "message" | "importModuleRepair"> {
    const refusal = `unknown constraint \`${constraint}\``;
    const alias = this.#aliasConstraints.get(constraint);
    if (alias === undefined) {
      if (constraint.includes(".")) return { message: refusal };
      return {
        message: `${refusal}; import its home module with ` +
          `\`import module ${constraint}\` for qualified access, or import the ` +
          "constraint by name",
        importModuleRepair: { name: constraint, namespace: "constraint" },
      };
    }
    const only = alias.exported.length === 1 ? alias.exported[0]! : undefined;
    if (only === undefined) {
      return {
        message: `${refusal}; \`${constraint}\` is a module alias — the constraints it exports ` +
          `are reached through it, as \`${constraint}.Name\``,
      };
    }
    return {
      message: `${refusal}; \`${constraint}\` is a module alias — write \`${constraint}.${only}\` ` +
        `for the constraint it exports, name it bare with ` +
        `\`import { ${only} } from ${JSON.stringify(alias.specifier)}\`, ` +
        `or realias as \`import module ${only}\``,
    };
  }

  /** Whether a constraint *named* here declares implied type members. */
  #bearsProjection(constraint: string): boolean {
    return this.#projectionBearingConstraints.has(
      this.#constraintIdentity(constraint),
    );
  }

  /**
   * The dictionary slot path from `constraint` down to `target`, or `undefined`
   * when the first does not entail the second — both **named in this module's
   * own source**, so both go through `#constraintIdentities`.
   *
   * Every call site holding a *requirement* rather than a spelling uses
   * `#entailmentPath` instead. The distinction is the whole of #276's checker
   * half: a requirement may name a constraint this module cannot spell, and
   * asking this question about its name walks the wrong declaration's bases —
   * or, far worse, no declaration's, which answers "entailed, empty path" for
   * `constraint === target` and reduces the requirement to a dictionary that is
   * not the one it asked for.
   */
  #baseConstraintPath(
    constraint: string,
    target: string,
  ): readonly string[] | undefined {
    return this.#entailmentPath(
      this.#constraintIdentity(constraint),
      this.#constraintIdentity(target),
    );
  }

  /** `#baseConstraintPath` between two constraint **declarations** (§5.1.1). */
  #entailmentPath(
    identity: string,
    target: string,
    seen = new Set<string>(),
  ): readonly string[] | undefined {
    if (identity === target) return [];
    if (seen.has(identity)) return undefined;
    seen.add(identity);
    // Constraints §6.2: through the one minting function, so the slot this walk
    // *reads* is the slot the honor block *wrote*. Minting from the base's name
    // as written here was the second currency — it took whatever word the
    // extending declaration happened to write, so an importer's alias, or the
    // qualified form, silently projected a slot no dictionary had (#718).
    for (const base of this.#baseConstraintSlots(identity)) {
      const suffix = this.#entailmentPath(base.identity, target, seen);
      if (suffix !== undefined) return [base.slot, ...suffix];
    }
    return undefined;
  }

  /**
   * §6.2's base list of a constraint **declaration**, each entry carrying the
   * dictionary slot it owns.
   *
   * The single source both sides of a base slot mint from: `#entailmentPath`
   * above reads slots out of it, and `#honorBaseConstraints` writes them into
   * the Typed tree for emission. Names are canonicalized first — the list holds
   * the words the *extending* module wrote, and a slot follows the identity —
   * and the contest is then a function of the resulting canonical list alone.
   */
  #baseConstraintSlots(
    identity: string,
  ): readonly {
    readonly name: Typed.ConstraintName;
    readonly identity: string;
    readonly slot: string;
  }[] {
    const bases = this.#baseConstraintsOf(identity).map((base) => ({
      identity: base.identity,
      name: this.#canonicalConstraintName(base.name, base.identity),
    }));
    const slots = mintBaseConstraintSlots(bases.map(({ name }) => name));
    return bases.map((base, index) => ({ ...base, slot: slots[index]! }));
  }

  /** The base constraints of a constraint **declaration**, name and identity. */
  #baseConstraintsOf(
    identity: string,
  ): readonly { readonly name: string; readonly identity: string }[] {
    const declared = this.#constraintsByIdentity.get(identity);
    if (declared !== undefined) {
      return declared.baseConstraints.map((name, index) => ({
        name,
        // Positional, and minted where the declaration was written. The
        // resolver builds both arrays in one walk of the written list, so the
        // index is total; there is deliberately no fall back to this module's
        // view, which would be exactly the re-derivation the field exists to
        // prevent and which §6.2 now forbids by name (#718).
        identity: declared.baseConstraintIdentities[index]!,
      }));
    }
    return (PRE_REGISTERED_BASE_CONSTRAINTS[identity] ?? []).map((name) => ({
      name,
      identity: preRegisteredConstraintIdentity(name),
    }));
  }

  #validate(requirement: Requirement): void {
    if (requirement.reported) return;
    const type = this.#prune(requirement.type);
    if (type.kind === "Variable" || type.kind === "Error") return;
    // No early return for a primitive since #344's last landing. A requirement
    // at one discharges through `#instances` below, exactly as a requirement at
    // a nominal type does — this line used to answer first, from the wired
    // table, and answering was what left the requirement without the
    // dictionary emission needs.
    //
    // Every arm below asks which pre-registered constraint this requirement
    // demands, and every one of them asks by **identity** (#727). A requirement
    // carries the spelling its demand site wrote — `S` under `import { Show as
    // S }`, `M.Show` under `import module M` — and a name-keyed arm declined for
    // both, letting the requirement fall through to the instance table so that
    // `show((1, 2))` was refused for want of an instance no module can write.
    //
    // Two questions per arm, and only the first is the gate. The second is what
    // the arm then demands **of the contents**, and it is the one that fails
    // silently: a wrong pick type-checks and emits a dictionary whose element
    // evidence answers a different constraint, which throws at the first slot
    // read. `Show` walks a map's keys and values; `Hash` and `Eq` walk them
    // differently. So the picks read the identity too, and the conformance file
    // discriminates them with element types that honor one side and not the
    // other — an `Int` element satisfies all four and proves nothing.
    //
    // The canonical words the picks *spell* (`#require("Hash", …)`) are the
    // compiler's own choice and stay names: `#constraintIdentities` seeds the
    // pre-registered eleven and no import may rebind one. The structural walk is
    // the exception, forwarding the identity it was given because it asks the
    // *same* constraint of each component — hardening rather than a repair, and
    // the currency an imported scheme's unspellable requirement would need.
    if (
      STRUCTURAL_IDENTITIES.has(requirement.identity) &&
      (type.kind === "Tuple" || type.kind === "Record" || type.kind === "Vector")
    ) {
      // The component requirements are *kept* (#278). Each one names the
      // instance the component contributes, and emission renders that selection
      // rather than re-walking the type — the re-walk is what silently ignored a
      // hand-written component instance and read through `opaque`.
      const components: readonly (readonly [string, Mono])[] = type.kind === "Tuple"
        ? type.elements.map((element, index) => [String(index), element] as const)
        : type.kind === "Record"
        ? [...type.fields.entries()]
        : [["element", type.element] as const];
      requirement.components = components.map(([key, component]) => ({
        key,
        requirement: this.#require(
          requirement.name,
          component,
          requirement.span,
          "operation",
          undefined,
          requirement.identity,
        ),
      }));
      requirement.structural = true;
      return;
    }
    if (requirement.identity === CONCAT_IDENTITY && type.kind === "Vector") {
      // No component demand: concatenation is on the spine alone.
      requirement.components = [];
      requirement.structural = true;
      return;
    }
    if (HASHED_CONTAINER_IDENTITIES.has(requirement.identity) && type.kind === "Set") {
      requirement.components = [{
        key: "element",
        requirement: this.#require(
          requirement.identity === SHOW_IDENTITY ? "Show" : "Hash",
          type.element,
          requirement.span,
        ),
      }];
      requirement.structural = true;
      return;
    }
    if (HASHED_CONTAINER_IDENTITIES.has(requirement.identity) && type.kind === "Map") {
      requirement.components = requirement.identity === SHOW_IDENTITY
        ? [
            { key: "key", requirement: this.#require("Show", type.key, requirement.span) },
            { key: "value", requirement: this.#require("Show", type.value, requirement.span) },
          ]
        : [
            { key: "key", requirement: this.#require("Hash", type.key, requirement.span) },
            {
              key: "value",
              requirement: this.#require(
                requirement.identity === HASH_IDENTITY ? "Hash" : "Eq",
                type.value,
                requirement.span,
              ),
            },
          ];
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
      DERIVABLE_IDENTITIES.has(requirement.identity)
    ) {
      // No component demand: the pin satisfies the constraint outright, and
      // emission's `Bool` arms are the licensed inline shortcut (#278).
      requirement.components = [];
      requirement.structural = true;
      return;
    }
    const instance = this.#instances.get(this.#instanceKey(requirement.identity, type));
    if (instance !== undefined) {
      this.#pinInstanceSubject(instance, type, requirement.span);
      // A provided row (Part 5 §4) has no module to have exported a dictionary,
      // so it takes the structural channel instead of the instance one: the
      // slot is rendered inline at the use, exactly as `Bool`'s four and the
      // container walks are. This is ruling 2 of #353 — the table is the
      // semantics and static dispatch is its *erasure*, not a mechanism beside
      // it — and it is why the row can sit in a real coherence slot without
      // inventing an import channel for a name no module writes. `components`
      // is empty because the row satisfies the constraint outright: iterating
      // a `Vector(a)` demands nothing of `a`.
      if (this.#providedIterableRows.has(instance)) {
        requirement.components = [];
        requirement.structural = true;
      } else {
        requirement.dictionary = instance.dictionary;
        requirement.dictionaryArguments = this.#instanceArguments(instance, type);
      }
      if (requirement.impliedTypes !== undefined) {
        const bindings = this.#instanceImpliedTypes.get(instance);
        const replacements = this.#matchInstanceSubject(instance, type);
        for (const [name, projection] of requirement.impliedTypes) {
          const binding = bindings?.get(name);
          if (binding !== undefined) {
            this.#unify(
              projection,
              this.#replaceVariables(binding, replacements),
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
          : this.#userNominalIterableFailure(requirement, type) ??
            this.#missingInstanceMessage(requirement, type),
      primary: requirement.span,
    });
  }

  /**
   * The generic missing-instance report, carrying Modules §7.6's **legal-homes
   * clause** (#287, #633).
   *
   * The head is Constraints §8's — "type `X` has no `C` instance" — and the
   * clause is appended to it. §7.6's exemplar opens differently ("no `Ord<Config>`
   * instance is in the program"), but the unsatisfied-constraint row of
   * Constraints §8 owns the head shape and every pin in the corpus reads it; the
   * *clause* is what §7.6 obliges, and it is the conformance content. Recorded
   * here so the next reader does not re-adjudicate it from the exemplar alone.
   *
   * The clause says where the honor could be written, and it is the orphan rule
   * (Constraints §5.3) that makes that a closed question: exactly two modules
   * may hold `honor C<T>` — the one declaring `C` and the one declaring `T` —
   * so the report hands the reader a lookup rather than a search. Three shapes
   * come out of that, and the branch below is only choosing between them:
   *
   * - **Ordinary.** Both homes are named; each is *offered* — with a path the
   *   reader can open — only where the honor could be written in project source.
   *   A prelude home is stated as fact and never as a repair, the same asymmetry
   *   the §3.3 loop-head report already keeps and the same one §7.6's exemplar
   *   spells (`./config` offered, "the module declaring `Ord`" stated).
   * - **Closed pair.** When *neither* home is offerable — a prelude constraint
   *   at a primitive or prelude subject — there is no honor to offer at all, and
   *   an impossible fixit would be worse than none: the clause says the pair's
   *   honored set is closed and points at the two ways out that need no instance.
   * - **Unnameable.** When the required constraint is not nameable in this
   *   module, the two-home template is *wrong*: the subject's own module is a
   *   lawful home in which the honor cannot be written, because no import or
   *   alias here reaches the constraint's name. §7.6 names the declaring module
   *   alone and directs the honor there — which is exactly what the sealing
   *   idiom's stranded reader is owed (Modules §4.3).
   *
   * Anything the clause cannot be *true* about falls back to the bare head:
   * a structural subject has no home module to name (§7.6's own carve-out), and
   * a compilation with no paths — a bare `check` in a unit harness — cannot name
   * a file. That is the fourth gate of the §3.3 report, kept for the same reason:
   * a fixit naming no openable file is not a fixit.
   *
   * **The derivation fixit joins the report** where the missing constraint is
   * one the subject could simply `derives` (§7.6's composition bullet, #644).
   * Two compositions, and `#derivationFixit` chooses between them because the
   * choice is a fact about the constraint, not about this message:
   *
   * - **Appended** at `Eq`/`Ord`/`Show`. The two-home clause is still true —
   *   either home may hold a hand-written honor — so it stands, and Constraints
   *   §8's fixit follows it as the cheaper repair. The fixit names no file: the
   *   clause in front of it has just named the only one it could mean.
   * - **Replacing** at `Hash`, the one *derivable-only* constraint. Both homes
   *   remain legal and neither may hold the form the two-home template invites,
   *   because Collections Part 2 §4.1 refuses a hand-written `Hash` in every
   *   user module. §7.6's precedent — a home is offered only where what the
   *   reader would write there is accepted — makes the clause a wrong offer, so
   *   the replacement sentence carries the seat *and* the path itself. Where the
   *   subject's `Eq` is hand-written, derivation is barred outright (Part 2
   *   §4.3) and the wrapper-key route replaces clause and fixit alike.
   *
   * Anything outside that gate is byte-identical to what it printed before.
   */
  #missingInstanceMessage(requirement: Requirement, type: Mono): string {
    const head = `type \`${this.#display(type)}\` has no \`${requirement.name}\` instance`;
    const clause = this.#legalHomesClause(requirement, type);
    const fixit = this.#derivationFixit(requirement, type);
    if (fixit === undefined) return clause === undefined ? head : `${head}${clause}`;
    // `clause` is never `undefined` on the appending arm: the fixit's gate is the
    // ordinary branch's `subjectSeat`, which is strictly narrower than the
    // clause's own. The coalesce is the honest spelling of that rather than a
    // second claim about it — a `!` here would assert what the gate already
    // guarantees, in the one file where the guarantee could later move.
    return fixit.replaces ? `${head}${fixit.text}` : `${head}${clause ?? ""}${fixit.text}`;
  }

  /** Modules §7.6's clause, or `undefined` where the head must stand alone. */
  #legalHomesClause(requirement: Requirement, type: Mono): string | undefined {
    const here = this.#modulePath;
    if (here === undefined) return undefined;
    const constraintHome = this.#constraintHome(requirement.identity);
    if (constraintHome === undefined) return undefined;
    // Asked **before** the branch split, not inside the ordinary arm. §7.6 scopes
    // the whole obligation — the sealed branch included — to "subjects that have
    // a declaring module to name", and a structural subject has no lawful home
    // under *either* branch: Constraints §5.4/§9.3 refuse a structural instance
    // head outright, so directing the reader at the constraint's own module would
    // offer an honor no file in the program may hold. The bare head is the only
    // true report there.
    const subjectHome = this.#subjectHome(type);
    if (subjectHome === undefined) return undefined;
    if (this.#sealedConstraint(requirement.identity)) {
      // §7.6's unnameable branch. `path` is present whenever the compilation has
      // paths at all, since a constraint this module cannot spell was still
      // declared by a file in the graph; the guard is the same honesty as above.
      if (constraintHome.path === undefined) return undefined;
      const seat = relativeFilePath(here, constraintHome.path);
      // §5.1.1's disambiguate-by-home remedy, for the reader who has just written
      // a constraint of this very spelling and would read "not nameable here" as
      // simply false. What they cannot name is the *declaration*, not the word,
      // and only the home module tells the two apart.
      const rival = this.#constraintIdentities.get(constraintHome.name);
      if (rival !== undefined && rival !== requirement.identity) {
        return `; the \`${constraintHome.name}\` required here is ` +
          `\`${seat}\`'s, not the one this module names; the honor can only be ` +
          "written there";
      }
      return `; \`${constraintHome.name}\` is not nameable here, so the honor ` +
        `can only be written in \`${seat}\`, which declares it`;
    }
    const constraintSeat = constraintHome.path === undefined
      ? undefined
      : relativeFilePath(here, constraintHome.path);
    const subjectSeat = subjectHome.path === undefined
      ? undefined
      : relativeFilePath(here, subjectHome.path);
    if (subjectSeat !== undefined && constraintSeat !== undefined) {
      return subjectSeat === constraintSeat
        ? `; it could only be declared in \`${subjectSeat}\`, which declares both ` +
          `\`${subjectHome.name}\` and \`${constraintHome.name}\``
        : `; it could only be declared in \`${subjectSeat}\` (declares ` +
          `\`${subjectHome.name}\`) or \`${constraintSeat}\` (declares ` +
          `\`${constraintHome.name}\`)`;
    }
    if (subjectSeat !== undefined) {
      return `; it could only be declared in \`${subjectSeat}\` (declares ` +
        `\`${subjectHome.name}\`) or ${constraintHome.statedHome}`;
    }
    if (constraintSeat !== undefined) {
      return `; it could only be declared in \`${constraintSeat}\` (declares ` +
        `\`${constraintHome.name}\`) or ${subjectHome.statedHome}`;
    }
    return `; its only legal homes are ${constraintHome.statedHome} and ` +
      `${subjectHome.statedHome}, both outside project source, so this pair's ` +
      "honored set is closed — change the type, or go through the operations " +
      "those homes export";
  }

  /**
   * Modules §7.6's **derivation fixit** and its composition, or `undefined`
   * where no fixit is owed (#644). `replaces` is the composition: `false`
   * appends the text after the legal-homes clause, `true` stands in its place.
   *
   * **The gate is three facts, and each one is a truth requirement.**
   *
   * 1. *The constraint is derivable* — one of Constraints §4.5's four, asked of
   *    the requirement's **identity**. §7.6 pins the channel, and §5.1.1 is why:
   *    a spelling can be occluded, an identity cannot.
   * 2. *The subject has a `derives` seat in project source* — a union or nominal
   *    record with a path to name. `#subjectHome`'s `path` is exactly that
   *    question already answered: only a nominal declaration ever carries one,
   *    and it is withheld for a prelude-supplied one. Primitives, prelude
   *    nominals, extern types and structural subjects therefore fall out here
   *    with their branches untouched, which is what "gates as proposed" means.
   * 3. *The compilation has paths at all.* Implied by (2) for the appended form,
   *    and load-bearing for the replacing one, which prints a path of its own.
   *
   * Under that gate the clause the fixit composes with is always the ordinary
   * branch's offered-subject shape: the sealed branch cannot be reached (all
   * four constraints are prelude-declared and exported), and neither can the
   * coincident-home or constraint-seat-only arms, since `#constraintHome`
   * withholds the path of every pre-registered constraint.
   *
   * **Base-completeness** (James's point 3): a fixit that compiles when followed.
   * Where a base of the required constraint is itself absent, following a bare
   * `derives Ord` would only trade this error for the missing-base one, so every
   * absent base is named alongside — and every base of the derivable four is
   * itself derivable, so the list the fixit prints is always writable. The bases
   * are read from the declaration through `#baseConstraintsOf`, by identity,
   * rather than re-listed here.
   *
   * All four of §7.6's `Hash` cells are reachable, and one of them is the cell
   * the two questions above make least obvious: the *no-list* dialect with a
   * **derived** `Eq` present. It exists because derivation has two spellings —
   * Constraints §4.5's core form `honor Eq<Point> = derive` and the `derives`
   * header sugar — so a declaration carrying no `derives` clause at all can still
   * have a derived `Eq` beside it. That is also why the dialect question and the
   * provenance question are asked of different things: the dialect is a fact
   * about the declaration's text, and provenance is a fact about the *instance*,
   * and reading the second off the first would call `= derive` hand-written.
   */
  #derivationFixit(
    requirement: Requirement,
    type: Mono,
  ): { readonly replaces: boolean; readonly text: string } | undefined {
    if (!DERIVABLE_IDENTITIES.has(requirement.identity)) return undefined;
    const here = this.#modulePath;
    if (here === undefined) return undefined;
    const home = this.#subjectHome(type);
    if (home?.path === undefined) return undefined;
    const declaration = this.#nominalDeclaration(type);
    if (declaration === undefined) return undefined;
    // §8 speaks two dialects, and which one is right is a fact about the
    // declaration's text: a `derives` clause is either there to extend or not
    // there to write. Emptiness is the whole test — the resolver carries the
    // written names verbatim (`Union.derives`/`RecordDeclaration.derives`), and
    // a declaration that carries any of them has the clause.
    const carriesList = declaration.derives.length > 0;
    const name = this.#constraintsByIdentity.get(requirement.identity)?.name ??
      requirement.name;
    const spelling = this.#derivationSpelling(requirement.identity, name, type);
    if (requirement.identity !== preRegisteredConstraintIdentity("Hash")) {
      return {
        replaces: false,
        text: carriesList
          ? `; add \`${spelling}\` to the \`derives\` list of \`${declaration.name}\``
          : `; add \`derives ${spelling}\` to the declaration of \`${declaration.name}\``,
      };
    }
    // The provenance channel is the instance record's own `derived` flag — the
    // same one the derive-site Eq-agreement check reads (Collections Part 2
    // §4.3). A *derived* `Eq` or none at all leaves `derives Hash` writable;
    // a hand-written one bars it, and no repair through this type's own
    // instances exists, so the report states the requirement and §4.5's route.
    const equality = this.#instances.get(
      this.#instanceKey(preRegisteredConstraintIdentity("Eq"), type),
    );
    if (equality !== undefined && !equality.derived) {
      return {
        replaces: true,
        text: "; `derives Hash` requires a derived `Eq`, and " +
          `\`${declaration.name}\` declares its own — key on a wrapper type ` +
          "whose `Eq` and `Hash` are both derived",
      };
    }
    const seat = relativeFilePath(here, home.path);
    return {
      replaces: true,
      // The head states §4.5's law positively (#647, James's point 4): one voice
      // with the member-block refusal's own head, and a sentence that tells the
      // reader what to write rather than what not to.
      text: `; ${HASH_MUST_BE_DERIVED}, so the only repair is ` +
        (carriesList
          ? `adding \`${spelling}\` to \`${declaration.name}\`'s \`derives\` list in \`${seat}\``
          : `\`derives ${spelling}\` on the declaration of \`${declaration.name}\` in \`${seat}\``),
    };
  }

  /**
   * Constraints §8's **base-complete** spelling for `derives` at this subject —
   * the bare name where every base is already satisfied, the parenthesised list
   * where one is not. `#derivationFixit` above states why the completeness is
   * owed; this is only where it is computed.
   *
   * The derivability filter is a **guard, not a no-op**: today every base of the
   * derivable four is `Eq`, so it drops nothing, and it is what keeps the fixit
   * compilable if that ever stops being true — a non-derivable base named in a
   * `derives` list would be refused at the seat the fixit sent the reader to.
   * Whoever finds it redundant should add the base that makes it matter, not
   * delete it. The bases are read from the declaration through
   * `#baseConstraintsOf`, by identity, rather than re-listed here.
   *
   * Shared by #644's use-site fixit and #647's member-block refusal, which owe
   * the reader the same list for the same reason and must not drift apart in
   * what they spell.
   */
  #derivationSpelling(identity: string, name: string, type: Mono): string {
    const absentBases = this.#baseConstraintsOf(identity)
      .filter(({ identity: base }) =>
        DERIVABLE_IDENTITIES.has(base) &&
        this.#instances.get(this.#instanceKey(base, type)) === undefined
      )
      .map(({ name: base }) => base);
    // Declaration order, bases first: `derives (Eq, Ord)` is the order a
    // `derives` clause is written in, and the order the missing-base row would
    // have demanded them in.
    return absentBases.length === 0
      ? name
      : `(${[...absentBases, name].join(", ")})`;
  }

  /**
   * Collections Part 2 §9's report for a refused member-block `honor Hash<T>`
   * (#647) — or `undefined` where the seat is **silent**.
   *
   * The refusal is §4.1's and does not move: `Hash` is derivable-only, and every
   * user module refuses the hand-written form. What James ruled is that the
   * refusal joins #644's advice family — the same head, the same list-aware and
   * base-complete fixit — and that the advice offered must be advice the reader
   * can take. Five rows come out of that, and the branch below is only choosing
   * between them:
   *
   * 1. **A project-source nominal whose `Eq` is absent or derived.** Constraints
   *    §8's fixit in both dialects, base-complete in each — `(Eq, Hash)` where
   *    no `Eq` instance exists, `Hash` alone beside a derived one. The subject is
   *    named always; the *file* only when the declaration is not this one. That
   *    gate is deliberately softer than #644's, which prints a path
   *    unconditionally: there the report hangs off a use site that may be
   *    anywhere, while here the refused `honor` is itself the anchor, so a
   *    pathless compilation degrades to naming the subject and nothing worse.
   *    The elsewhere-file branch is reachable only in an already-orphan program
   *    — a member-block honor outside `T`'s file, `Hash`'s other home being the
   *    prelude — and the orphan error stands beside this one, both pointing at
   *    the same file.
   * 2. **A project-source nominal whose `Eq` is hand-written.** The advice of row
   *    1 would itself be refused (§4.3), so §4.5's wrapper route stands in its
   *    place — the same sentence #644's replacement fixit reaches, seated after
   *    this refusal's head.
   * 3. **A prelude nominal.** A `derives` seat exists and the reader cannot edit
   *    it. Modules §7.6's offering discipline says name the fact, never the
   *    repair, so the head carries one true sentence and no fixit.
   * 4. **No `derives` seat at all** — a primitive outside #344's carve-out, an
   *    extern type, a structural subject. There is a subject, it has no
   *    declaration to edit, and the report says exactly that.
   * 5. **A subject annotation that does not resolve, or a head that is a bare
   *    type variable.** Silent, on one principle read at two widths (#647's
   *    rider): no advice is owed about a subject the checker cannot *name*, nor
   *    about one that cannot *host an instance at all*. The resolver has already
   *    reported the unknown name against this very span, and Constraints §5.4
   *    has already refused the variable head; either is the whole answer. The
   *    refusal still stands in both cases — the instance never joins the table —
   *    and only the sentence is withheld.
   *
   * The two arms of row 5 are asked in different channels, and deliberately.
   * "Did not resolve" is the **resolver's** answer: `ErrorType` is precisely
   * "this annotation named nothing", while an `Error` mono is reachable from
   * several unrelated failures. "Is a variable" is a fact about the *elaborated*
   * type, which is what makes one check cover both `honor Hash<a>` and
   * `honor<a> Hash<a>` — they take different §5.4 messages and are the same
   * subject.
   */
  #handWrittenHashRefusal(item: Resolved.HonorItem): string | undefined {
    if (item.subject.kind === "ErrorType") return undefined;
    const subject = this.#prune(this.#instanceSubjects.get(item) ?? ERROR);
    // Row 5's **second arm**, and the one asked of the elaborated type rather
    // than the annotation: a head that is a bare type variable. Constraints
    // §5.4 refuses it outright — `honor Hash<a>` takes the must-name-a-
    // constructor message, `honor<a> Hash<a>` the parameterized-head one — and
    // that refusal is the whole answer. One check covers both spellings because
    // both elaborate to a variable, which is the fact that matters: a variable
    // is not a subject with a bad `derives` seat, it is not a subject at all.
    if (subject.kind === "Variable") return undefined;
    // Declaration and prelude provenance are read together because only the
    // narrowed subject can answer the second, and `#preludeUnionIds`
    // /`#preludeRecordIds` are the occlusion-proof channel for it — the same one
    // `#subjectHome` consults, so the answer never rides on a name (Modules
    // §5.5).
    const nominal = subject.kind === "Union"
      ? {
          declaration: this.#nominalDeclaration(subject),
          preludeSupplied: this.#preludeUnionIds.has(subject.union),
        }
      : subject.kind === "NominalRecord"
      ? {
          declaration: this.#nominalDeclaration(subject),
          preludeSupplied: this.#preludeRecordIds.has(subject.record),
        }
      : undefined;
    if (nominal === undefined || nominal.declaration === undefined) {
      return `${HASH_MUST_BE_DERIVED}, and this subject has no declaration that ` +
        "could carry a `derives` clause";
    }
    const declaration = nominal.declaration;
    if (nominal.preludeSupplied) {
      return `${HASH_MUST_BE_DERIVED}; derivation is spelled on the subject's ` +
        "declaration, which is not in project source";
    }
    // The provenance channel is the instance record's own `derived` flag — the
    // same one the derive-site Eq-agreement check in this arm reads, and the
    // same one #644's fixit reads. A *derived* `Eq` or none at all leaves
    // `derives Hash` writable; a hand-written one bars it outright.
    const equality = this.#instances.get(
      this.#instanceKey(preRegisteredConstraintIdentity("Eq"), subject),
    );
    if (equality !== undefined && !equality.derived) {
      return `${HASH_MUST_BE_DERIVED}, and \`derives Hash\` requires a derived ` +
        `\`Eq\` — \`${declaration.name}\` declares its own; key on a wrapper ` +
        "type whose `Eq` and `Hash` are both derived";
    }
    const spelling = this.#derivationSpelling(
      preRegisteredConstraintIdentity("Hash"),
      "Hash",
      subject,
    );
    const advice = declaration.derives.length > 0
      ? `add \`${spelling}\` to \`${declaration.name}\`'s \`derives\` list`
      : `use \`derives ${spelling}\` on the declaration of \`${declaration.name}\``;
    const here = this.#modulePath;
    const there = declaration.declaringPath;
    // Two facts, not one: the compilation has paths at all, and the declaration
    // is somewhere else. Same-file is the ordinary case and names no file — the
    // `honor` the caret sits on is already in the file the reader must open.
    const elsewhere = here !== undefined && there !== undefined && there !== here
      ? ` in \`${relativeFilePath(here, there)}\``
      : "";
    return `${HASH_MUST_BE_DERIVED}; ${advice}${elsewhere}`;
  }

  /**
   * Whether §7.6's **unnameable** branch governs this requirement: the constraint
   * is unexported, and no name in this module reaches its declaration.
   *
   * Both halves are load-bearing, and the first is the one the spec's own
   * justification turns on — "the subject's module is a lawful home in which the
   * honor cannot be *written*, **since the unexported constraint is reachable
   * there by no import or alias**". "Not spelled here" is a weaker fact than
   * "not spellable here", and only the second licenses the branch: an **exported**
   * constraint the reporting module merely never imported is one `import` away,
   * so the subject's own module *is* a writable home and the two-home template is
   * the right report. Taking the sealed branch for it denies the home that works
   * and directs the reader at one that cannot — the acyclic-import rule (§7.3)
   * forbids the constraint's module from naming a type declared downstream of it.
   * §7.6 files that shape under discoverability *residue* (its bullet (a)), not
   * here.
   *
   * `exported` is read off the declaration rather than re-derived, and it travels
   * with it through every hop (`ConstraintItem.exported`). All three sealed
   * routes — a private middle link of a base chain, a private constraint gating
   * an exported binding, a private base of an exported one (#626/#633) — carry
   * `false` and keep this branch.
   *
   * The nameability half is asked of identities and answered from
   * `#constraintIdentities` — this module's name → identity map, seeded with the
   * pre-registered eleven and extended by its own declarations and its imports.
   * A requirement copied out of an imported scheme carries the *defining*
   * module's identity, and the map is deliberately not total over those. It is
   * derived from what the module could write, never from what the program
   * contains: `#constraintsByIdentity` reaches every declaration in the graph,
   * private middle links included (#276), and reading nameability off *it* would
   * offer a home whose honor the reader cannot even spell the constraint for.
   * The half still matters after the `exported` gate, for the one module where an
   * unexported constraint *is* nameable — the one that declares it.
   */
  #sealedConstraint(identity: string): boolean {
    const declaration = this.#constraintsByIdentity.get(identity);
    if (declaration === undefined || declaration.exported) return false;
    for (const known of this.#constraintIdentities.values()) {
      if (known === identity) return false;
    }
    return true;
  }

  /**
   * The constraint half of the legal-homes pair: its declaration's name, the
   * file it was written in, and — for a home outside project source — the phrase
   * that states it as fact.
   *
   * `path` is present only where the home is **offerable**: a pre-registered
   * constraint's declaration lives in the prelude (Constraints §5.1.1's third
   * bullet, and all eleven have prelude source), where no user may write an
   * honor, so its path is withheld and `statedHome` carries it instead. The test
   * is the `hex:` identity space rather than the name, which is what makes it
   * occlusion-proof: a module's own `constraint Ord` would be a different
   * identity (and is refused outright), and the eleven are the whole of the
   * prelude's constraint inventory.
   */
  #constraintHome(identity: string): LegalHome | undefined {
    const declaration = this.#constraintsByIdentity.get(identity);
    if (declaration === undefined) return undefined;
    const statedHome = `the module declaring \`${declaration.name}\``;
    if (isPreRegisteredIdentity(identity)) {
      return { name: declaration.name, statedHome };
    }
    // An offerable home with no path is not offerable in any useful sense — the
    // reader is handed a repair and no file to make it in. The head stands alone.
    if (declaration.declaringPath === undefined) return undefined;
    return { name: declaration.name, path: declaration.declaringPath, statedHome };
  }

  /**
   * The subject half of the pair — `undefined` for a subject with no home module
   * to name, which is §7.6's own carve-out: a tuple, a function type, a
   * structural record, and the structural collection heads have no declaring
   * module, and their refusals keep the messages they already have.
   *
   * A **primitive** does have a home — its fixed prelude companion (Constraints
   * §5.3, #344) — and that home is never offerable: `honor Integral<BigInt>` is
   * legal in exactly two prelude files and in no user module. `Unit` and `Exn`
   * are deliberately outside the table: §5.3 puts `Unit` under the structural
   * instances with no home and none needed, and `Exn` has no companion.
   *
   * A prelude-supplied nominal is named as fact for the same reason its
   * `Iterable` twin is (§3.3's third gate): the fixit would name a file the user
   * cannot edit. `#preludeUnionIds`/`#preludeRecordIds` are the occlusion-proof
   * channel for that question, so the answer does not ride on a name.
   *
   * **Two unlike facts leave through this one `undefined`, and only one of them
   * is a truth requirement.** For a *structural* subject no home exists anywhere
   * — Constraints §5.4/§9.3 refuse a structural instance head outright — so the
   * bare message is the only true report, and every branch above must fall back:
   * that is why `#legalHomesClause` asks this question before it splits. For an
   * *extern type* a home does exist, the file holding its `extern` block; it
   * leaves here only because `Resolved.ExternTypeDeclaration` carries no
   * `declaringPath` to name it with, which makes the fallback merely
   * conservative — never wrong, only less. Whoever gives extern types a
   * `declaringPath` should return a home for them here and must not let the
   * structural case ride out on the same predicate.
   */
  #subjectHome(type: Mono): LegalHome | undefined {
    if (type.kind === "Constructor") {
      return PRIMITIVE_COMPANION_HOMES.has(type.name)
        ? {
          name: type.name,
          statedHome: `\`${type.name}\`'s prelude companion module`,
        }
        : undefined;
    }
    if (type.kind !== "Union" && type.kind !== "NominalRecord") return undefined;
    const declaration = this.#nominalDeclaration(type);
    if (declaration === undefined) return undefined;
    const preludeSupplied = type.kind === "Union"
      ? this.#preludeUnionIds.has(type.union)
      : this.#preludeRecordIds.has(type.record);
    const statedHome = `the prelude module declaring \`${declaration.name}\``;
    if (preludeSupplied) return { name: declaration.name, statedHome };
    // As in `#constraintHome`: a home this module could write in, with no file
    // to name, is not a home worth offering.
    if (declaration.declaringPath === undefined) return undefined;
    return { name: declaration.name, path: declaration.declaringPath, statedHome };
  }

  /**
   * The **resolved declaration** behind a nominal subject, or `undefined` for a
   * type that is not one.
   *
   * This module's view first, then the whole program's — the same pairing, and
   * the same reason, as the §3.3 report's: a nominal reached only through an
   * imported function's type is in neither of this module's own tables.
   *
   * Split out of `#subjectHome` for #644's fixit, which needs the declaration
   * itself and not only its home: whether a `derives` clause is already written
   * there is what chooses between Constraints §8's two dialects, and only the
   * declaration knows.
   */
  #nominalDeclaration(
    type: Mono,
  ): Resolved.Union | Resolved.RecordDeclaration | undefined {
    if (type.kind === "Union") {
      return this.#unions.get(type.union) ??
        find(this.#programNominals.unions, type.union);
    }
    if (type.kind === "NominalRecord") {
      return this.#records.get(type.record) ??
        find(this.#programNominals.records, type.record);
    }
    return undefined;
  }

  /**
   * Collections Part 5 §3.3's report for a `for p in e` head whose type is a
   * **user nominal** with no `Iterable` instance — or `undefined` where this
   * failure is not that case and the generic requirement failure stands.
   *
   * The message exists because the compiler always knows both legal homes: the
   * orphan rule (Modules §7.6) makes the search space exactly two — the module
   * declaring the type, and the module declaring the constraint — so the report
   * can hand the user a *closed* space rather than a hint. It leads with the
   * actionable home, names the other to explain why no third module could
   * supply the instance, and closes with the two ways out that need no instance
   * at all.
   *
   * Four things gate it, and each one failing means the generic message is the
   * honest answer:
   *
   * - **The origin is a loop head.** A `toSeq(x)` call that fails elsewhere is
   *   not this diagnostic's subject (see `Requirement.origin`).
   * - **The type is a nominal union or record.** An `ExternType` is declared by
   *   a foreign block, not by a Hexagon declaration with parameters to spell,
   *   and every structural type has no home module at all.
   * - **The declaration is not prelude-supplied.** `Option`, `Result`, `Bool`,
   *   `Ordering` and their kin sit outside §3's user-nominal arm precisely
   *   because the fixit would name a file the user cannot edit. `preludeUnions`
   *   /`preludeRecords` are the occlusion-proof channel for that question
   *   (Modules §5.5), which is why they are consulted rather than the names.
   * - **Both paths are known.** The declaring module's path and this module's
   *   own path are what turn the fixit into a file the user can open; a bare
   *   `check` in a test has neither.
   *
   * The fixit's subject is spelled **binder-less** — `honor Iterable<Bag(a)>`,
   * never `honor<a> Iterable<Bag(a)>` — per Constraints §5.4 as amended by
   * #390: a parameterized head introduces its own binders, and the `<...>`
   * prefix exists to constrain them, not to name them. It spells the
   * *declaration's* parameter names rather than the failing type's arguments,
   * because §5.4's head is one constructor applied to distinct variables:
   * `Bag(Int)` fails, and `honor Iterable<Bag(a)>` is what fixes it.
   */
  #userNominalIterableFailure(
    requirement: Requirement,
    type: Mono,
  ): string | undefined {
    if (requirement.origin !== "iteration") return undefined;
    if (type.kind !== "Union" && type.kind !== "NominalRecord") return undefined;
    // This module's own view first, then the whole program's. The second half
    // is load-bearing rather than defensive: a nominal reached only through an
    // imported function's *type* — `main` iterating what `a.hex` returns from
    // `b.hex`, having never imported `b` — is registered nowhere in this
    // module's tables, and the report would silently fall back to the generic
    // form for exactly the case where the declaring file is hardest to guess.
    const declaration: Resolved.Union | Resolved.RecordDeclaration | undefined =
      type.kind === "Union"
        ? this.#unions.get(type.union) ?? find(this.#programNominals.unions, type.union)
        : this.#records.get(type.record) ?? find(this.#programNominals.records, type.record);
    if (declaration === undefined) return undefined;
    const preludeSupplied = type.kind === "Union"
      ? this.#preludeUnionIds.has(type.union)
      : this.#preludeRecordIds.has(type.record);
    if (preludeSupplied) return undefined;
    const declaringPath = declaration.declaringPath;
    if (declaringPath === undefined || this.#modulePath === undefined) return undefined;
    const subject = declaration.parameters.length === 0
      ? declaration.name
      : `${declaration.name}(${declaration.parameters.join(", ")})`;
    return `\`${this.#display(type)}\` is not iterable. Define \`honor Iterable<${subject}>\` in ` +
      `\`${relativeFilePath(this.#modulePath, declaringPath)}\`, which declares \`${declaration.name}\`. ` +
      "The only other legal home is the prelude module declaring `Iterable`. " +
      `Alternatively, convert with \`${declaration.name}.toSeq\`-style functions, or take a \`Seq(a)\` parameter.`;
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
      // The structural constructors, which only the provided `Iterable` rows
      // put in the table (#353). Without these the match returns empty at a
      // `Vector(a)` head and `Item` unifies against the *formal* binder rather
      // than the element — the projection would type as a rigid variable and
      // every `toSeq(v)` would be a mismatch.
      if (formal.kind === "Vector" && actual.kind === "Vector") {
        match(formal.element, actual.element);
      }
      if (formal.kind === "Set" && actual.kind === "Set") {
        match(formal.element, actual.element);
      }
      if (formal.kind === "Array" && actual.kind === "Array") {
        match(formal.element, actual.element);
      }
      if (formal.kind === "Map" && actual.kind === "Map") {
        match(formal.key, actual.key);
        match(formal.value, actual.value);
      }
      if (formal.kind === "JsSet" && actual.kind === "JsSet") {
        match(formal.element, actual.element);
      }
      if (formal.kind === "JsMap" && actual.kind === "JsMap") {
        match(formal.key, actual.key);
        match(formal.value, actual.value);
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
    if (actual.kind === "JsSet") return { kind: "JsSet", element: this.#replaceVariables(actual.element, replacements) };
    if (actual.kind === "Node") return { kind: "Node", element: this.#replaceVariables(actual.element, replacements) };
    if (actual.kind === "Nullable") return { kind: "Nullable", value: this.#replaceVariables(actual.value, replacements) };
    if (actual.kind === "Map" || actual.kind === "JsMap") {
      return {
        kind: actual.kind,
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
        ...(actual.effect === undefined
          ? {}
          : { effect: this.#replaceVariables(actual.effect, replacements) }),
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
    // The deadline (§3.1): no DotCall goal may escape its owner region's
    // finalisation, and the defaulting step below must see the receivers those
    // goals settle.
    this.#resolveDotCallGoals(level);
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
        this.#refuseOrDefault(variable, variable.requirements[0]!.span);
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
        const seatReport = annotation ?? variable.ascribedAt;
        if (variable.rigidName !== undefined && seatReport !== undefined) {
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
            primary: seatReport,
          });
          variable.instance = ERROR;
          continue;
        }
        // Sunk so no enclosing generalization can quantify what this one
        // declined — the same sink the `!allow` branch below performs, and the
        // handoff's Defect 7 invariant.
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
        const declineReport = annotation ?? variable.ascribedAt;
        if (variable.rigidName !== undefined && declineReport !== undefined) {
          this.#diagnostics.add({
            severity: "error",
            message:
              `\`${variable.rigidName}\` is a declared type variable, but this right-hand ` +
              `side is a computation that cannot be generalized in \`${variable.rigidName}\` ` +
              `(${this.#declineReason(variable.rigidName, variable, declined)}); ` +
              "bind where the type is known, or remove the annotation",
            primary: declineReport,
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
          // The effect slot is one more component of the function type (#355
          // §3.4), so it is one more occurrence here, at the arrow's own sign —
          // a colour is a fact about invoking this function, which is what the
          // result position already means. Skipping it made every effect
          // variable read as absent, and an absent variable defaults to `inv`:
          // item 7 declined it, and a computed binding's face was pinned
          // monomorphic for no reason anyone had stated (#364).
          if (actual.effect !== undefined) walk(actual.effect, sign);
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
        case "JsSet":
        case "Node":
          walk(actual.element, multiplyVariance(sign, compilerClaim(actual.kind, 0)));
          return;
        case "Nullable":
          walk(actual.value, multiplyVariance(sign, compilerClaim("Nullable", 0)));
          return;
        case "Map":
        case "JsMap":
          walk(actual.key, multiplyVariance(sign, compilerClaim(actual.kind, 0)));
          walk(actual.value, multiplyVariance(sign, compilerClaim(actual.kind, 1)));
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
        this.#refuseOrDefault(actual, actual.requirements[0]!.span);
        continue;
      }
      // Ascription §3.1's orphaned variable: a declared variable that occurs
      // nowhere in the declaration's type, so nothing generalized it and no call
      // site could ever determine its evidence. Reaching here means the
      // constraint is not one defaulting could have discharged either — the
      // refusal above handles those — and `#reportBlockedDefaulting` is silent
      // about declared variables by design, so without this the declaration
      // compiles with an obligation nothing can meet.
      if (actual.ascribedAt !== undefined && !actual.requirements.every(({ reported }) => reported)) {
        const names = [...new Set(actual.requirements.map(({ name }) => name))];
        for (const requirement of actual.requirements) requirement.reported = true;
        this.#diagnostics.add({
          severity: "error",
          message:
            `\`${actual.rigidName}\` is a declared type variable that this declaration's ` +
            `type does not mention, so no call site can determine its \`${names.join("`, `")}\` ` +
            `evidence; ascribe a concrete type, or name a type variable the declaration uses`,
          primary: actual.ascribedAt,
        });
        actual.instance = ERROR;
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
   * `#display` reads this for **every** report (Constraints §8, #649); §6's own
   * seat still calls it after settling, because settling is what display may
   * not do.
   *
   * Fresh names are deduped against every name already *visible in the
   * displayed type*: its declared variables and any survivor already carrying a
   * display name. Seeding from `rigidName` alone was enough while the only
   * caller ran once per type, but a sticky name minted by an earlier report is
   * as visible as a declared one — without it a second report on
   * `Pair(?1, ?2)`, one half already named `a`, would name the other `a` too.
   *
   * A variable in an *effect* slot is skipped: it prints through `#arrow` as a
   * colour (`->?¹`), never as a name, so spending a letter on it would only
   * shift the letters the type's own variables get. The two notations cannot be
   * confused for each other either: a numbered arrow carries its ordinal in
   * **superscript** digits (`arrows.ts`), so §10's `->?¹` and the `?N` this law
   * abolishes are typographically disjoint.
   */
  #nameSurvivingVariables(type: Mono): void {
    const variables = this.#collectVariables(type);
    const colours = new Set(this.#effectVariables(type));
    const taken = new Set<string>();
    for (const { rigidName, displayName } of variables) {
      if (rigidName !== undefined) taken.add(rigidName);
      if (displayName !== undefined) taken.add(displayName);
    }
    let index = 0;
    for (const variable of variables) {
      if (variable.rigidName !== undefined || variable.displayName !== undefined) continue;
      if (colours.has(variable.id)) continue;
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
      variable.requirements.every((requirement) => this.#satisfiedAt(requirement, "Int")) &&
      variable.requirements.some((requirement) => !this.#satisfiedAt(requirement, "Unit"));
  }

  /**
   * By identity in both halves (#727), as **currency hardening and not a
   * repair** — said plainly because the difference is not visible from the code.
   *
   * A name-keyed `Unit` half does answer differently for a second spelling, but
   * no program was found that reaches the difference, and neither keying kills a
   * test: every route found carries a numeric literal, whose `Num` requirement
   * is not satisfied at `Unit` under any spelling and so decides the `some(…)`
   * on its own — an observation about the routes tried, not a proved bound. The flip is here because the pair either side of it
   * reads identities and a lone name-keyed neighbour is what the arc was about —
   * not because a specimen was measured. If one is ever found, it belongs beside
   * the container-pick specimens, which are the shape of a discriminating one.
   */
  #satisfiedAt(requirement: Requirement, subject: "Int" | "Unit"): boolean {
    if (subject === "Unit") return STRUCTURAL_IDENTITIES.has(requirement.identity);
    return this.#instances.has(
      this.#instanceKey(requirement.identity, primitive(subject)),
    );
  }

  /**
   * Numeric Literals §4's defaulting rule, as its #344 edit note amends it: a
   * constraint is defaultable exactly when **the prelude** supplies its `Int`
   * instance. The rule did not change; where the `Int` instances live did. A
   * wired row answered while `Int` was compiler-wired; since `Int.hex` took its
   * seat, the source `honor` block answers, and reading the retired table here
   * would report every numeric literal in the language as ambiguous.
   *
   * §7 still rejects Haskell-style extensible defaulting, and the set is still
   * closed against user code — now structurally rather than by decree, with two
   * independent guarantees. The **belt** is `#defaultableAtInt`'s
   * pre-registered test: a user's `Conjure` has a declared identity, not
   * `hex:Conjure`, so `honor Conjure<Int>` never enters the set however it is
   * spelled. The **suspenders** is the orphan rule (Constraints §5.3, with the
   * companion as `Int`'s home module), which leaves no site where user source
   * could legally honor a pre-registered constraint at `Int` in the first
   * place.
   *
   * Contrast `#satisfiedAt`, which answers §6's different, *semantic* question
   * and deliberately does consult user instances.
   */
  #canDefaultToInt(variable: Variable): boolean {
    return variable.requirements.length > 0 &&
      this.#blockingConstraint(variable) === undefined;
  }

  /** The first constraint outside §4's closed set, which blocks defaulting. */
  #blockingConstraint(variable: Variable): Requirement | undefined {
    return variable.requirements.find((requirement) => !this.#defaultableAtInt(requirement));
  }

  /**
   * Whether this requirement's constraint is one the prelude honors at `Int`,
   * read from the one channel a primitive instance now takes (#344) and gated
   * on the constraint being pre-registered.
   *
   * The gate asks that of the **identity** and of nothing else (#727). It used
   * to mint `hex:<the written name>` and compare, which is the same question
   * only while every spelling of a pre-registered constraint is its own: a
   * requirement written `S` under `import { Show as S }` carries `hex:Show`,
   * failed a comparison against `hex:S`, and reported ``\`S\` is not a
   * defaultable constraint`` at a literal the `Show` spelling defaults happily.
   * The identity is already in hand and answers the real question — is this
   * declaration the compiler's? — which is exactly `isPreRegisteredIdentity`.
   */
  #defaultableAtInt(requirement: Requirement): boolean {
    if (!isPreRegisteredIdentity(requirement.identity)) return false;
    return this.#instances.has(this.#instanceKey(requirement.identity, primitive("Int")));
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
      if (actual.effect !== undefined) this.#collectVariables(actual.effect, found);
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
    if (actual.kind === "JsSet") this.#collectVariables(actual.element, found);
    if (actual.kind === "Node") this.#collectVariables(actual.element, found);
    if (actual.kind === "Nullable") this.#collectVariables(actual.value, found);
    if (actual.kind === "Map" || actual.kind === "JsMap") {
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
    /**
     * The type a **constraint member's** subject is pinned at for this one
     * reference (Modules §5.3's qualified access through an honoring module).
     * Applied before the copy walks, so the requirement the copy records is
     * already the concrete one selection will answer.
     */
    pinnedSubject?: Mono,
  ): Mono {
    const replacements = new Map<number, Variable>();
    const copiedRequirements = new Set<number>();
    // Freshening is **ordinal-preserving**: the copies are minted in ascending
    // id order, so their own ids come out in the same order (#447). A scheme
    // variable's id *is* FFI Part 9 §6.2's type-variable ordinal — binders mint
    // in declared-head order, and `dictionaryEntries` reads the ordinal back by
    // sorting on the number. (Where no binder names a constrained variable it
    // mints at first use instead; Part 9 §6.2.1 leaves that placement to us,
    // since such a function is refused export and its suffix is unobservable.
    // Preserving the id order is what keeps both ends of its calls agreeing.)
    // Meanwhile `scheme.variables` is in the order
    // generalization met the variables in the *type*, which is a different
    // sequence the moment a head is spelled `<b, a>` over `(x: a, y: b)`.
    // Minting in array order renumbers that head as if it were `<a, b>`, and
    // every scheme built on the copy inherits the wrong ordinal: the alias `let
    // alias = pair` emits as the bare `pair` and so answers to *pair's* suffix,
    // while its consumers key on the alias's own ids.
    for (const variable of [...scheme.variables].sort((left, right) => left.id - right.id)) {
      replacements.set(variable.id, this.#fresh(level, variable.literalOnly));
    }
    /**
     * The copies destined for `collected`, held back so they can be published in
     * the callee's **ABI** order rather than in the order `copy` happens to
     * reach them (#447).
     *
     * `copy` walks the *type*, so pushing at the point of copy publishes
     * *(first occurrence of the variable in the type, order the constraints were
     * attached)*. The ABI is *(type-variable ordinal, constraint name)* — FFI
     * Part 9 §6.2 — and both components differ: a head whose binder order is not
     * the order the binders occur in the type gets the variables wrong, and a
     * head spelling conjuncts non-alphabetically gets one variable's own
     * dictionaries wrong. Neither is caught downstream, because the arity is
     * right either way: `<a: (Show, Num)>` handed the `Show` dictionary to the
     * `Num` slot and died at `.add`, and `<b: Show, a: Show>` swapped two
     * dictionaries of the same shape and merely answered wrong.
     *
     * This is the one place holding both the callee's scheme variables and the
     * fresh slot each requirement was copied onto, and it is the single choke
     * point for every collecting caller, so the order is fixed here — at the
     * producer. The alternative, aligning the argument list against the scheme
     * in the emitter, has nothing to align *with*: `Core.CallEvidence` carries
     * no slot identity, and a callee that is not a name has no scheme in hand.
     */
    const ordered: {
      readonly ordinal: number;
      readonly constraint: string;
      readonly requirement: Requirement;
    }[] = [];
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
            // The member's *own* constraint is what projects the implied types,
            // matched on the declaration rather than its spelling so an
            // imported member projects exactly as a local one does.
            requirement.identity === scheme.constraintIdentity
              ? impliedTypes
              : undefined,
            // A copy demands the same *declaration* as its original. Re-deriving
            // the identity from the name would break an imported scheme, whose
            // constraint this module may not be able to spell at all (§5.1.1).
            requirement.identity,
          );
          // The copy keeps the definition-site span, so it keeps the digits
          // that span points at too (§6's report names both) — and records
          // where the use was, for a report that is about the use.
          if (requirement.literal !== undefined) copied.literal = requirement.literal;
          if (useSpan !== undefined) copied.useSpan = useSpan;
          // `actual.id` is the *originating scheme* variable, which is the id
          // `dictionaryEntries` sorts the callee's parameters under; the
          // canonical name is the one `#publicRequirement` will publish, so the
          // key here is the key there, character for character (#447).
          if (collected !== undefined) {
            ordered.push({
              ordinal: actual.id,
              constraint: this.#canonicalConstraintName(
                requirement.name,
                requirement.identity,
              ),
              requirement: copied,
            });
          }
        }
        return replacement;
      }
      if (actual.kind === "Function") {
        return {
          kind: "Function",
          parameters: actual.parameters.map(copy),
          result: copy(actual.result),
          ...(actual.effect === undefined ? {} : { effect: copy(actual.effect) }),
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
      if (actual.kind === "JsSet") return { kind: "JsSet", element: copy(actual.element) };
      if (actual.kind === "Node") return { kind: "Node", element: copy(actual.element) };
      if (actual.kind === "Nullable") return { kind: "Nullable", value: copy(actual.value) };
      if (actual.kind === "Map" || actual.kind === "JsMap") {
        return { kind: actual.kind, key: copy(actual.key), value: copy(actual.value) };
      }
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
    const instantiated = copy(scheme.type);
    if (collected !== undefined) {
      // §6.2's key, sorted **stably**, which is what carries the tie-break
      // across. A tie is two same-named constraints from different declarations
      // on one variable (Constraints §5.1.1) — distinct arguments that no key
      // separates. The callee breaks it by the order that variable's own
      // requirement list has (`#publicScheme` enumerates it, `dictionaryEntries`
      // sorts stably over it), and so does this: one variable's requirements are
      // pushed contiguously, in that same list order.
      ordered.sort((left, right) =>
        left.ordinal - right.ordinal ||
        left.constraint.localeCompare(right.constraint)
      );
      for (const { requirement } of ordered) collected.push(requirement);
    }
    const subject = scheme.constraintSubject === undefined
      ? undefined
      : replacements.get(scheme.constraintSubject.id);
    if (pinnedSubject !== undefined && subject !== undefined && useSpan !== undefined) {
      this.#unify(subject, pinnedSubject, useSpan);
    }
    return instantiated;
  }

  #unsupported(span: Source.Span, message: string): ErrorMono {
    this.#diagnostics.add({ severity: "error", message, primary: span });
    return ERROR;
  }

  /**
   * A type alias's elaborated right-hand side, once per item.
   *
   * Two readers want it and they must agree: materialization publishes it as the
   * alias's `.d.ts` face, and §4.3's boundary check walks it for private
   * nominals (#621). Elaborating it twice would report whatever the right-hand
   * side draws twice — and the boundary check reaches aliases no use site ever
   * elaborates, so both reports would be its own. Memoized on the item, which is
   * the unit both readers hold.
   */
  #aliasTarget(item: Resolved.TypeAliasItem): Mono {
    const cached = this.#aliasTargets.get(item);
    if (cached !== undefined) return cached;
    const parameters = this.#aliasParameters.get(item) ?? new Map();
    const target = this.#inPosition(
      "alias",
      () => this.#annotationType(item.annotation, 0, new Map(), parameters),
    );
    this.#aliasTargets.set(item, target);
    return target;
  }

  #annotationType(
    annotation: Resolved.TypeAnnotation,
    level = 0,
    namedTails = new Map<string, Variable>(),
    typeParameters: ReadonlyMap<string, Mono> = new Map(),
    impliedTypes: ReadonlyMap<string, Mono> = new Map(),
    /**
     * The variable each **written** hole has been given, by `id` (§4.1). Its
     * lifetime is `namedTails`': one map per elaboration of one annotation,
     * defaulted here so every caller gets a fresh one. That is exactly the scope
     * the rule needs — an alias applied at a hole copies the node into several
     * positions of the *same* annotation, so the copies share, while the same
     * alias applied in a second definition elaborates separately and shares
     * nothing with the first.
     */
    holes = new Map<number, Variable>(),
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
        element: this.#annotationType(annotation.element, level, namedTails, typeParameters, impliedTypes, holes),
      };
    }
    if (annotation.kind === "Set") {
      return { kind: "Set", element: this.#annotationType(annotation.element, level, namedTails, typeParameters, impliedTypes, holes) };
    }
    if (annotation.kind === "Array") return { kind: "Array", element: this.#annotationType(annotation.element, level, namedTails, typeParameters, impliedTypes, holes) };
    if (annotation.kind === "JsSet") return { kind: "JsSet", element: this.#annotationType(annotation.element, level, namedTails, typeParameters, impliedTypes, holes) };
    if (annotation.kind === "Node") return { kind: "Node", element: this.#annotationType(annotation.element, level, namedTails, typeParameters, impliedTypes, holes) };
    if (annotation.kind === "Nullable") return { kind: "Nullable", value: this.#annotationType(annotation.value, level, namedTails, typeParameters, impliedTypes, holes) };
    if (annotation.kind === "Map" || annotation.kind === "JsMap") {
      return {
        kind: annotation.kind,
        key: this.#annotationType(annotation.key, level, namedTails, typeParameters, impliedTypes, holes),
        value: this.#annotationType(annotation.value, level, namedTails, typeParameters, impliedTypes, holes),
      };
    }
    if (annotation.kind === "Function") {
      const effect = this.#writtenEffect(annotation.effect, annotation.arrowSpan);
      return {
        kind: "Function",
        parameters: annotation.parameters.map((parameter) =>
          this.#annotationType(parameter, level, namedTails, typeParameters, impliedTypes, holes)
        ),
        result: this.#annotationType(
          annotation.result,
          level,
          namedTails,
          typeParameters,
          impliedTypes,
          holes,
        ),
        ...(effect === undefined ? {} : { effect }),
      };
    }
    // The written qualifier rides the elaborated node from here (FFI Part 7
    // §2.4 rung 3): it is a property of the *occurrence*, and this is the one
    // place an occurrence becomes a type.
    if (annotation.kind === "Union") {
      return {
        kind: "Union",
        union: annotation.union,
        name: annotation.name,
        arguments: annotation.arguments.map((argument) =>
          this.#annotationType(argument, level, namedTails, typeParameters, impliedTypes, holes)
        ),
        ...(annotation.qualifier === undefined ? {} : { qualifier: annotation.qualifier }),
      };
    }
    if (annotation.kind === "RecordDeclaration") {
      return {
        kind: "NominalRecord",
        record: annotation.record,
        name: annotation.name,
        arguments: annotation.arguments.map((argument) =>
          this.#annotationType(argument, level, namedTails, typeParameters, impliedTypes, holes)
        ),
        ...(annotation.qualifier === undefined ? {} : { qualifier: annotation.qualifier }),
      };
    }
    if (annotation.kind === "ExternType") {
      return {
        kind: "ExternType",
        externType: annotation.externType,
        name: annotation.name,
        ...(annotation.qualifier === undefined ? {} : { qualifier: annotation.qualifier }),
      };
    }
    if (annotation.kind === "TypeVariable") {
      const existing = typeParameters.get(annotation.name);
      if (existing !== undefined) return existing;
      if (typeParameters instanceof Map) {
        // `#ascribedTypeSpan` is set exactly while an *ascription's* type is
        // being elaborated, so only a name this ascription is the first to write
        // in its declaration is marked as ascription-declared. A name the
        // signature already wrote is found above and returns that variable
        // untouched — it is the binder's, and Functions §8's arms already reach
        // it through the binding's own annotation.
        const variable = this.#fresh(
          level,
          false,
          annotation.name,
          undefined,
          this.#ascribedTypeSpan,
        );
        typeParameters.set(annotation.name, variable);
        // *(#700.)* A member's annotations declare their own variables, binder
        // or no binder (§4.2.1's "rigidity is independent of the binder"), and
        // §7.4 refuses two of them meeting through the knot with the same
        // message it gives two written heads. `#annotationOwner` is set exactly
        // while a `fun` member's body is being checked.
        this.#recordDeclaredHead(variable, this.#annotationOwner);
        return variable;
      }
      return ERROR;
    }
    if (annotation.kind === "Hole") {
      // The whole of a hole's semantics (closure doc §4.1): the same variable,
      // created the same way, as for an unannotated position. No `rigidName`, so
      // unification, accumulation, defaulting and generalization all reach it as
      // they reach any inference variable — there is no hole-specific clause
      // anywhere downstream, and there must not be one.
      //
      // Once per *written* hole, not once per node. `type Pair(a) = (a, a)`
      // applied as `Pair(_)` substitutes one written hole into both element
      // positions, and freshening per node would make `Pair(_)` a pair of two
      // unrelated types — un-writing the alias's own contract, and accepting
      // `(1, "two")`. The same memoization named variables already get from
      // `typeParameters`; holes key on `id` because they have no name.
      const existing = holes.get(annotation.id);
      if (existing !== undefined) return existing;
      const variable = this.#fresh(level, false);
      holes.set(annotation.id, variable);
      this.#typeHoles.push({ span: annotation.span, type: variable });
      // A written list seeds the accumulation register (§4.4) — no
      // `declaredConstraints`, which is what would make it a cap: seeding is a
      // floor, accumulation continues past it, and everything downstream reads
      // the one set. Seeded inside the memo, so an alias applied at one written
      // hole raises one obligation however many positions the body has.
      for (const constraint of annotation.constraints) {
        if (!this.#constraintNames.has(constraint)) {
          this.#diagnostics.add({
            severity: "error",
            ...this.#unknownConstraint(constraint),
            primary: annotation.span,
          });
          continue;
        }
        if (this.#bearsProjection(constraint)) {
          this.#diagnostics.add({
            severity: "error",
            message: impliedTypeBinderMessage(constraint, this.#constraintIdentity(constraint)),
            primary: annotation.span,
          });
          continue;
        }
        this.#require(constraint, variable, annotation.span, "annotation");
      }
      return variable;
    }
    if (annotation.kind === "ImpliedType") {
      return impliedTypes.get(annotation.name) ?? ERROR;
    }
    if (annotation.kind === "Tuple") {
      return {
        kind: "Tuple",
        elements: annotation.elements.map((element) =>
          this.#annotationType(element, level, namedTails, typeParameters, impliedTypes, holes)
        ),
      };
    }
    if (annotation.kind === "Record") {
      return {
        kind: "Record",
        fields: new Map(annotation.fields.map((field) => [
          field.name,
          this.#annotationType(field.annotation, level, namedTails, typeParameters, impliedTypes, holes),
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
   * Elaborates an instance's `type Name = τ` bindings into
   * `#instanceImpliedTypes`, in the scope the subject was elaborated in — after
   * it, so every binder of the instance is visible to τ: the `<...>` prefix's,
   * and the ones the head itself introduces, both now minted before the subject
   * elaborates (#390). A name τ introduces beyond that scope is
   * outside Collections Part 2 §5.3's closed set ("in-scope type names and the
   * instance's own binders"): the binding stores `ERROR`, and the mint
   * is removed from the binder map so instantiation never mistakes it for an
   * instance parameter. `report` is true only in the declaring module — an
   * imported instance's bindings were checked at home, and re-reporting here
   * would blame the importer.
   */
  #storeInstanceImpliedTypes(
    instance: Resolved.HonorItem,
    typeParameters: Map<string, Variable>,
    report: boolean,
  ): void {
    const impliedTypes = new Map<string, Mono>();
    for (const binding of instance.impliedTypes) {
      // First binding of each name wins here; the duplicate is diagnosed where
      // the declaration's requirements are walked.
      if (impliedTypes.has(binding.name)) continue;
      const before = new Set(typeParameters.keys());
      let type = this.#annotationType(binding.annotation, 0, new Map(), typeParameters);
      const minted = [...typeParameters.keys()].filter((name) => !before.has(name));
      if (minted.length > 0) {
        for (const name of minted) typeParameters.delete(name);
        if (report) {
          this.#diagnostics.add({
            severity: "error",
            message: `\`${minted[0]!}\` is not one of this instance's binders; ` +
              "an implied type binding may mention only in-scope type names and " +
              "the instance's own binders",
            primary: binding.span,
          });
        }
        type = ERROR;
      }
      impliedTypes.set(binding.name, type);
    }
    this.#instanceImpliedTypes.set(instance, impliedTypes);
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
      constraintIdentity: imported.constraintIdentity,
      typeParameters: imported.typeParameters,
      subject: imported.subject,
      // The declaring module's word, carried across every hop (#644). It used to
      // be hard-coded `false`, which was harmless while nothing downstream asked
      // — no member body is re-checked here, and the emitter reaches the
      // exporter's dictionary either way — and stopped being harmless the moment
      // §7.6's `Hash` report started asking whether the subject's `Eq` was
      // hand-written: every imported `Eq` read as one, and the modal library case
      // (`export record Point derives Eq` used as a `Set` element downstream) got
      // the wrapper-key report in place of the one-word repair.
      derived: imported.derived,
      dictionary: imported.localDictionary,
      // The declaring module's spellings, carried on so that a concrete member
      // call in *this* module can route to them (#444).
      memberSeats: imported.memberSeats,
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
    // The head's own binders, minted before the subject elaborates, exactly as
    // pass 1 mints them (#390). A fix applied only where instances are declared
    // silently skips every imported discharge — #388's lesson — because this is
    // the whole of what an importing module knows about the instance.
    //
    // Rigid and `#quantified`, matching pass 1; `declaredConstraints` stays
    // absent, unlike pass 1's `[]`. That is the one deliberate difference: the
    // empty list exists to turn a member body's requirement into a refusal
    // naming the `honor` header, and here there are no member bodies (`members`
    // is empty above) and no home-module span to blame — the declaring module
    // reported it, which is why `#storeInstanceImpliedTypes` is called with
    // `report` false as well. The declared binders above are older and plainer
    // still; they are left as they are because nothing on this path reads their
    // rigidity, and every use freshens them through `#pinInstanceSubject`.
    for (const name of headBinderNames(instance.subject)) {
      if (typeParameters.has(name)) continue;
      const variable = this.#fresh(0, false, name);
      this.#quantified.add(variable.id);
      this.#honorBinderVariables.add(variable.id);
      typeParameters.set(name, variable);
    }
    this.#instanceTypeParameters.set(instance, typeParameters);
    const subject = this.#annotationType(
      instance.subject,
      0,
      new Map(),
      typeParameters,
    );
    this.#instanceSubjects.set(instance, subject);
    this.#storeInstanceImpliedTypes(instance, typeParameters, false);
    const key = this.#instanceKey(imported.constraintIdentity, subject);
    const existingIdentity = this.#instanceIdentities.get(key);
    if (existingIdentity === imported.identity) return;
    if (existingIdentity !== undefined || this.#instances.has(key)) {
      // As above: one constraint declaration, so the bare name is the right
      // spelling. Before identity keying this report could name a constraint
      // *neither* module could see — two private `Describe`s colliding on the
      // word — which is what §5.1.1 forbids outright (#276).
      this.#diagnostics.add({
        severity: "error",
        message: `duplicate instance of \`${instance.constraint}<${this.#display(subject)}>\``,
        primary: imported.span,
      });
      return;
    }
    this.#admitInstance(key, imported.constraintIdentity, subject, instance);
    this.#instanceIdentities.set(key, imported.identity);
  }

  /**
   * Collections Part 5 §4's nine provided rows, seeded into the ordinary
   * evidence universe.
   *
   * **The table is the constraint** (Part 5 §1). The rows are compiler-provided
   * and have **no source form** (§4, and #353's ruling 1): `Seq`'s row cannot be
   * source because `Seq.hex` seats before `Iterable.hex` and a cycle is the only
   * other ordering; `Vector`'s cannot because a structural head is not a legal
   * `honor` subject (Constraints §5.4, enforced by `#checkInstanceHead`); the
   * rest follow. What they are *not* is a second mechanism beside the constraint
   * system — they occupy real coherence slots here, which is what makes §7.3's
   * orphan hint have something to find, `toSeq` resolve at a concrete provided
   * type, and Modules §5.3's `Vector.toSeq` read honest.
   *
   * Seeded internally rather than through `#seedImportedInstance`, deliberately.
   * That path rebuilds the subject and the implied types by *elaborating
   * annotations*, which is where an instance grows a second representation of
   * its binders (#392, still open). Here the subject Mono and the `Item` binding
   * are built together from one freshly minted rigid variable and stored
   * directly, so the two can no more disagree than a value can differ from
   * itself — which is #388's lesson applied ahead of the defect rather than
   * after it.
   *
   * All nine rows are seeded. The last two to arrive were FFI Part 10's borrowed
   * views, `JsMap(k, v)` and `JsSet(a)`, which waited on the types having a
   * representation to key a slot on at all (#396); their `Item` bindings are
   * Part 10 §6.1's, `(k, v)` and `a`. They are FFI-owned rows in the table
   * (Part 10 §10) but ordinary rows here: nothing about the seeding distinguishes
   * a borrowed view from a persistent collection, because the coherence slot does
   * not care where the value's storage lives.
   */
  #seedProvidedIterableRows(module: Resolved.Module): void {
    const declaration = this.#constraintsByIdentity.get(
      preRegisteredConstraintIdentity("Iterable"),
    );
    // No declaration in view is a compile with no prelude at all — the unit
    // harnesses. A row whose constraint cannot be named would be evidence for
    // a requirement nothing can raise.
    if (declaration === undefined) return;
    const span = declaration.span;
    const identity = preRegisteredConstraintIdentity("Iterable");
    const variable = (name: string): Variable => {
      const fresh = this.#fresh(0, false, name);
      this.#quantified.add(fresh.id);
      this.#honorBinderVariables.add(fresh.id);
      return fresh;
    };
    const annotation = (name: string): Resolved.TypeAnnotation => ({
      kind: "TypeVariable",
      name,
      span,
    });
    const seed = (
      head: string,
      binders: readonly string[],
      subject: (parameters: ReadonlyMap<string, Variable>) => Mono,
      item: (parameters: ReadonlyMap<string, Variable>) => Mono,
      subjectAnnotation: Resolved.TypeAnnotation,
    ): void => {
      const parameters = new Map(binders.map((name) => [name, variable(name)] as const));
      const instance: Resolved.HonorItem = {
        kind: "Honor",
        constraint: "Iterable",
        constraintIdentity: identity,
        typeParameters: binders.map((name) => ({ name, constraints: [], span })),
        subject: subjectAnnotation,
        derived: false,
        // Never emitted, and never reached: `#validate` marks a provided row's
        // requirement structural, so elaboration renders the dictionary inline
        // (`#derivedDictionary`'s `Iterable` arm) instead of naming a const no
        // module exports. The name is here because the field is not optional,
        // and it is `__`-prefixed so a stray emission would be a loud
        // ReferenceError rather than a silent capture of a user identifier.
        dictionary: `__provided_Iterable_${head}`,
        memberSeats: [],
        impliedTypes: [],
        members: [],
        span,
      };
      this.#instanceTypeParameters.set(instance, new Map(parameters));
      const subjectType = subject(parameters);
      this.#instanceSubjects.set(instance, subjectType);
      this.#instanceImpliedTypes.set(instance, new Map([["Item", item(parameters)]]));
      this.#providedIterableRows.add(instance);
      const key = this.#instanceKey(identity, subjectType);
      if (this.#instances.has(key)) return;
      this.#admitInstance(key, identity, subjectType, instance);
    };

    // `Range` → `Int`: the progression, ascending or descending per the value
    // (Loops §3). No binders; not in the conversion suite (§1).
    seed("Range", [], () => ({ kind: "Range" }), () => primitive("Int"), {
      kind: "Range",
      span,
    });
    seed(
      "Vector",
      ["a"],
      (parameters) => ({ kind: "Vector", element: parameters.get("a")! }),
      (parameters) => parameters.get("a")!,
      { kind: "Vector", element: annotation("a"), span },
    );
    seed(
      "Map",
      ["k", "v"],
      (parameters) => ({
        kind: "Map",
        key: parameters.get("k")!,
        value: parameters.get("v")!,
      }),
      (parameters) => ({
        kind: "Tuple",
        elements: [parameters.get("k")!, parameters.get("v")!],
      }),
      { kind: "Map", key: annotation("k"), value: annotation("v"), span },
    );
    seed(
      "Set",
      ["a"],
      (parameters) => ({ kind: "Set", element: parameters.get("a")! }),
      (parameters) => parameters.get("a")!,
      { kind: "Set", element: annotation("a"), span },
    );
    seed(
      "Array",
      ["a"],
      (parameters) => ({ kind: "Array", element: parameters.get("a")! }),
      (parameters) => parameters.get("a")!,
      { kind: "Array", element: annotation("a"), span },
    );
    // The two FFI-owned rows (FFI Part 10 §6.1). `JsMap` yields `(k, v)` and
    // needs no adaptation to: a native `Map`'s entries are two-element arrays,
    // which *is* the tuple representation (§6.3). Native insertion order is the
    // foreign object's own contract, inherited (§6.2) — stronger than the
    // persistent collections' arbitrary-but-stable order, and nothing here has
    // to arrange it.
    seed(
      "JsMap",
      ["k", "v"],
      (parameters) => ({
        kind: "JsMap",
        key: parameters.get("k")!,
        value: parameters.get("v")!,
      }),
      (parameters) => ({
        kind: "Tuple",
        elements: [parameters.get("k")!, parameters.get("v")!],
      }),
      { kind: "JsMap", key: annotation("k"), value: annotation("v"), span },
    );
    seed(
      "JsSet",
      ["a"],
      (parameters) => ({ kind: "JsSet", element: parameters.get("a")! }),
      (parameters) => parameters.get("a")!,
      { kind: "JsSet", element: annotation("a"), span },
    );
    // `Item = String`, one codepoint per item (§5.1). Hexagon has no `Char`, and
    // a one-codepoint `String` is what `s[i]` already answers.
    seed("String", [], () => primitive("String"), () => primitive("String"), {
      kind: "Primitive",
      name: "String",
      span,
    });
    // The identity row (§4), and it is *lawful* because `Seq` traversal is pure:
    // a persistent pure sequence is re-traversable, so the sequence view of
    // itself is itself. The unsound twin — identity handed to an effectful
    // producer — is not forbidden by convention but unspellable, since members
    // are pure (Effects §5) and `Stream.toSeq` is therefore structurally
    // inexpressible (`stream.md` §4–§5).
    //
    // Absent inside `stdlib/Seq.hex` itself, where the record is the module's
    // own rather than a prelude one. Nothing there can raise the requirement:
    // `Iterable.hex` seats *after* `Seq.hex`, so the member is not in scope.
    const sequence = module.preludeRecords.get("Seq");
    if (sequence !== undefined) {
      seed(
        "Seq",
        ["a"],
        (parameters) => ({
          kind: "NominalRecord",
          record: sequence,
          name: "Seq",
          arguments: [parameters.get("a")!],
        }),
        (parameters) => parameters.get("a")!,
        {
          kind: "RecordDeclaration",
          record: sequence,
          name: "Seq",
          arguments: [annotation("a")],
          span,
        },
      );
    }
  }

  /**
   * The coherence key: (constraint **declaration**, type constructor).
   *
   * The first component is a declaration identity, never a name
   * (`spec/constraints.md` §5.1.1) — two modules that each declare their own
   * `Describe` and each honor it for `Int` are both lawful, and a third module
   * importing both must not see a duplicate. Only `#seedImportedInstance` can
   * hold instances answering two same-named constraints at once, but keying
   * *every* lookup on the identity is what makes that seeding sound rather than
   * a special case.
   *
   * `#instanceKeyFor` is the name-taking entry point for the many call sites
   * that hold only a constraint name; this one takes the identity so the two
   * cross-module channels can pass the identity they were given.
   */
  #instanceKey(constraintIdentity: string, subject: Mono): string {
    return `${constraintIdentity}:${this.#subjectKey(subject)}`;
  }

  /**
   * The type-constructor half of the coherence key, alone.
   *
   * Split out of `#instanceKey` rather than written beside it: the reverse index
   * (`#instancesBySubject`) has to agree with selection exactly, and one function
   * is the only way to keep them from drifting apart.
   *
   * The fallback renders through `#display`, which since #649 *names* surviving
   * variables — so the rendered text alone no longer tells two unsolved
   * variables apart: five distinct ones all render `{n: a}` where they once
   * rendered `{n: ?431}`, `{n: ?437}`, and so on. A key is an identity, not a
   * message, so each survivor carries its id beside the text. That the 49
   * measured arrivals are all *lookups* — an admitted subject's variables are
   * head binders minted rigid at registration, so no key in the tables can
   * carry a survivor, and colliding lookups miss identically — is true, and is
   * exactly the kind of unstated invariant that gets broken innocently. Keying
   * by id costs one walk and removes the dependency instead of documenting it.
   */
  #subjectKey(subject: Mono): string {
    const type = this.#prune(subject);
    if (type.kind === "Constructor") return `primitive:${type.name}`;
    if (type.kind === "NominalRecord") return `record:${Number(type.record)}`;
    if (type.kind === "Union") return `union:${Number(type.union)}`;
    if (type.kind === "Range") return "range";
    // The structural constructors, keyed on the **head alone** like every other
    // row (#353). Falling through to `#display` below would key on the whole
    // type, so `Vector(Int)` and `Vector(String)` would take different slots —
    // which is not coherence, it is a cache. Nothing keyed here before the
    // provided `Iterable` rows arrived: `Eq`/`Ord`/`Show`/`Hash` at these
    // constructors are satisfied structurally and never enter the table, and a
    // source `honor` cannot name a structural head at all (Constraints §5.4).
    if (type.kind === "Vector") return "vector";
    if (type.kind === "Map") return "map";
    if (type.kind === "Set") return "set";
    if (type.kind === "Array") return "array";
    if (type.kind === "JsMap") return "jsmap";
    if (type.kind === "JsSet") return "jsset";
    const survivors = this.#collectVariables(type).filter(
      ({ rigidName }) => rigidName === undefined,
    );
    return survivors.reduce((key, { id }) => `${key}:?${id}`, this.#display(type));
  }

  /** Records an instance in both directions; the one writer of either table. */
  #admitInstance(
    key: string,
    constraintIdentity: string,
    subject: Mono,
    instance: Resolved.HonorItem,
  ): void {
    this.#instances.set(key, instance);
    const subjectKey = this.#subjectKey(subject);
    const honored = this.#instancesBySubject.get(subjectKey) ?? new Set<string>();
    honored.add(constraintIdentity);
    this.#instancesBySubject.set(subjectKey, honored);
  }

  /**
   * The coherence key for a constraint *named* in this module's own source.
   *
   * Sound because constraints are module-local in v1: within one module a
   * constraint name denotes at most one declaration, so name → identity is a
   * function here (`#constraintIdentities`). It is not sound across a module
   * boundary, which is why the two seeding channels carry an identity instead
   * of a name. When stage 2 makes constraints importable, this map is where an
   * imported constraint's identity joins — the call sites need not change.
   */
  #instanceKeyFor(constraint: string, subject: Mono): string {
    return this.#instanceKey(this.#constraintIdentity(constraint), subject);
  }

  /** This module's name → declaration-identity map; see `#instanceKeyFor`. */
  #constraintIdentity(constraint: string): string {
    return this.#constraintIdentities.get(constraint) ??
      declaredConstraintIdentity(this.#fileId, constraint);
  }

  #importScheme(scheme: Typed.Scheme): Scheme {
    const variables = new Map<Typed.TypeVariableId, Variable>();
    // The two orders a scheme's variable list carries, kept apart on purpose
    // (#447). Their *ids* are FFI Part 9 §6.2's ordinal — the defining module's
    // declared-head order, and the very numbers that module's
    // `dictionaryEntries` sorted its evidence parameters under — so the copies
    // are **minted** in ascending id order and inherit the ordinal. This is one
    // of only two places a scheme's variables are renumbered, and minting in
    // array order handed every cross-module call site a different ordinal from
    // the one the callee's parameter list was built with.
    //
    // The **array** order is a second, unrelated convention and is preserved
    // exactly: Part 8's specialization planner walks `scheme.variables` to name
    // its editions (`specializations.ts`, `mixIntBool`), so reordering the array
    // here would have the importer predict a spelling the definer never emitted
    // — a routed call to a function that does not exist under that name, or
    // worse, to the transposed edition, which is a wrong answer.
    const minted = new Map<Typed.TypeVariableId, Variable>();
    for (const id of [...scheme.variables].sort((left, right) => Number(left) - Number(right))) {
      const variable = this.#fresh(0, false);
      minted.set(id, variable);
      // Imported binders are already generalized by their defining module;
      // they must never be defaulted as unresolved locals in this module.
      this.#quantified.add(variable.id);
    }
    for (const id of scheme.variables) variables.set(id, minted.get(id)!);
    const copy = (type: Typed.Type): Mono => {
      switch (type.kind) {
        case "Primitive": return primitive(type.name);
        case "Range": return { kind: "Range" };
        case "Vector": return { kind: "Vector", element: copy(type.element) };
        case "Set": return { kind: "Set", element: copy(type.element) };
        case "Array": return { kind: "Array", element: copy(type.element) };
        case "JsSet": return { kind: "JsSet", element: copy(type.element) };
        case "Node": return { kind: "Node", element: copy(type.element) };
        case "Nullable": return { kind: "Nullable", value: copy(type.value) };
        case "Map": return { kind: "Map", key: copy(type.key), value: copy(type.value) };
        case "JsMap": return { kind: "JsMap", key: copy(type.key), value: copy(type.value) };
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
          ...(type.effect === undefined
            ? {}
            : {
              effect: type.effect === "impure"
                ? IMPURE
                : copy({ kind: "Variable", id: type.effect.variable }),
            }),
        };
        case "Error": return ERROR;
      }
    };
    for (const constraint of scheme.constraints) {
      // The identity travels with the imported constraint: this module may not
      // be able to spell the name at all, and if it can, the spelling may be
      // its own unrelated declaration (§5.1.1).
      this.#require(
        constraint.name,
        copy(constraint.type),
        constraint.span,
        "operation",
        undefined,
        constraint.identity,
      );
    }
    // A constraint member arrives as a member, not merely as a constrained
    // function (Modules §6.5): the subject and the implied types are variables
    // of *this* copy, so the projection `#instantiate` performs is the same one
    // it performs for a locally declared member.
    const membership = scheme.constraint;
    const subject = membership === undefined
      ? undefined
      : variables.get(membership.subject);
    return {
      variables: [...variables.values()],
      type: copy(scheme.type),
      ...(membership === undefined || subject === undefined
        ? {}
        : {
            constraint: membership.name,
            constraintIdentity: membership.identity,
            constraintSubject: subject,
            impliedTypes: new Map(
              membership.impliedTypes.flatMap(({ name, variable }) => {
                const copied = variables.get(variable);
                return copied === undefined ? [] : [[name, copied] as const];
              }),
            ),
          }),
    };
  }

  #nominalRecordFields(record: NominalRecordMono): ReadonlyMap<string, Mono> {
    // Modules §4.2: the representation travels with the type (#587). Everything
    // below reads two tables this module fills from `module.records` — which is
    // what its *imports* carried — so a type reached only through an imported
    // signature had no row at all here, and the fields the spec says are open
    // read as none.
    this.#materializeReachedRecord(record.record);
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
      if (actual.kind === "JsSet") return { kind: "JsSet", element: copy(actual.element) };
      if (actual.kind === "Node") return { kind: "Node", element: copy(actual.element) };
      if (actual.kind === "Nullable") return { kind: "Nullable", value: copy(actual.value) };
      if (actual.kind === "Map" || actual.kind === "JsMap") {
        return { kind: actual.kind, key: copy(actual.key), value: copy(actual.value) };
      }
      if (actual.kind === "Function") {
        return {
          kind: "Function",
          parameters: actual.parameters.map(copy),
          result: copy(actual.result),
          // A declared field's arrow keeps the colour it was written with. A
          // record has no signature to quantify over, so that colour is always
          // a constant (#355's data-position posture) — but dropping it here
          // silently reads every `->?` field as `->`.
          ...(actual.effect === undefined ? {} : { effect: copy(actual.effect) }),
        };
      }
      return actual;
    };
    return new Map(
      [...(this.#recordFields.get(record.record) ?? [])].map(([name, field]) => [name, copy(field)]),
    );
  }

  /**
   * The declaration a nominal record identity names, wherever in the **program**
   * it was written (#587).
   *
   * `#records` holds what this module's own text put there: its declarations
   * and the copies its imports carried. A type reaches further than that — an
   * imported signature carries it, and its home module is in the graph by
   * reachability — and Modules §4.2 says the representation reaches exactly as
   * far, so the judgment needs a table that does too. `#programNominals` is
   * already that table, accumulated dependency-first by `compileProject`
   * (`VarianceTable` reads it for §6.4's uniformity, for the same reason and
   * over the same shortfall); indexed here because a field access is a hot path
   * where the variance table's one-shot scan is not.
   *
   * **First copy wins, and it is the home module's.** Every module that imports
   * a record contributes its own `representationVisible: false` copy of the
   * declaration to the listing, and the accumulation is dependency-first, so
   * the declaring module's copy is the one already in the map when an
   * importer's arrives. The field rows agree either way — an imported copy is a
   * spread of the original — but `declaringPath` and the locality flag do not.
   */
  #programRecord(record: Resolved.RecordId): Resolved.RecordDeclaration | undefined {
    if (this.#programRecordIndex === undefined) {
      const index = new Map<Resolved.RecordId, Resolved.RecordDeclaration>();
      for (const declaration of this.#programNominals.records) {
        if (!index.has(declaration.id)) index.set(declaration.id, declaration);
      }
      this.#programRecordIndex = index;
    }
    return this.#programRecordIndex.get(record);
  }

  /**
   * The declaration a union identity names, wherever in the **program** it was
   * written — `#programRecord`'s twin, over the other half of `#programNominals`
   * (#605).
   *
   * First copy wins here for the same reason and by the same construction: the
   * accumulation is dependency-first, so the declaring module's copy is already
   * in the map when an importer's spread arrives, and it is the one whose
   * `representationVisible` and `declaringPath` say where the union lives.
   *
   * The by-constructor index is built beside it because a **pattern** asks the
   * question the other way round. `On => 1` names a constructor symbol and may
   * carry no union-typed expectation at all — the scrutinee can be a `String`,
   * which is exactly how the vacuous accept of #605's third symptom class
   * happened — so the symbol has to be able to find its own union.
   */
  #programUnion(union: Resolved.UnionId): Resolved.Union | undefined {
    this.#indexProgramUnions();
    return this.#programUnionIndex?.get(union);
  }

  #programConstructorUnion(constructor: Resolved.SymbolId): Resolved.UnionId | undefined {
    this.#indexProgramUnions();
    return this.#programConstructorIndex?.get(constructor);
  }

  #indexProgramUnions(): void {
    if (this.#programUnionIndex !== undefined) return;
    const unions = new Map<Resolved.UnionId, Resolved.Union>();
    const constructors = new Map<Resolved.SymbolId, Resolved.UnionId>();
    for (const declaration of this.#programNominals.unions) {
      if (unions.has(declaration.id)) continue;
      unions.set(declaration.id, declaration);
      for (const constructor of declaration.constructors) {
        constructors.set(constructor.binding.symbol, declaration.id);
      }
    }
    this.#programUnionIndex = unions;
    this.#programConstructorIndex = constructors;
  }

  /**
   * Registers a union this module reached without importing it, once, from the
   * home module's declaration (Modules §4.2, #605) — `#materializeReachedRecord`
   * over unions, and the same design.
   *
   * `module.unions` is the *importer's* listing: it holds this module's own
   * declarations and the copies its imports named, so a union arriving as an
   * imported function's result — `match make()` where nothing here writes `Flag`
   * — was in none of the four tables the eager pass fills. The judgments that
   * read them did not abstain: the coverage column took the arms as the
   * signature, a constructor pattern unified nothing, and the emitter read the
   * absence as an untagged representation.
   *
   * A no-op for everything already known, and written to the same four tables
   * the eager registration writes, in the same order — parameters before the
   * slot annotations read against them — so nothing downstream can tell which
   * pass filled them. A constructor imported severally already has a scheme from
   * `importedSchemes`; overwriting it is what the eager pass does for an
   * imported *copy* of a union, so the two routes still agree about the shape.
   *
   * **Stamped `representationVisible: false`, never the home copy's flag.** The
   * flag is not opacity — the resolver sets it on every imported copy regardless
   * — it is the locality signal `#checkPublicSignatures` reads to keep a type
   * that lives elsewhere out of §4.3's private-in-public check. A reached union
   * lives elsewhere by definition, and carrying the home module's `true` here
   * would refuse a perfectly public union as an escaping private type in every
   * module that happened to reach it.
   */
  #materializeReachedUnion(union: Resolved.UnionId): void {
    if (this.#unions.has(union)) return;
    const home = this.#programUnion(union);
    if (home === undefined) return;
    const declaration: Resolved.Union = { ...home, representationVisible: false };
    this.#unions.set(union, declaration);
    this.#reachedUnions.add(union);
    const typeParameters = new Map(
      declaration.parameters.map((name) => [name, this.#fresh(0, false)] as const),
    );
    this.#unionParameters.set(union, typeParameters);
    const type: UnionMono = {
      kind: "Union",
      union,
      name: declaration.name,
      arguments: [...typeParameters.values()],
    };
    for (const constructor of declaration.constructors) {
      this.#constructorUnions.set(constructor.binding.symbol, union);
      const slotParameters = this.#inPosition("union", () =>
        constructor.slots.map((slot) =>
          this.#annotationType(slot.annotation, 0, new Map(), typeParameters)
        ));
      this.#schemes.set(constructor.binding.symbol, {
        variables: [...typeParameters.values()],
        type: slotParameters.length === 0
          ? type
          : { kind: "Function", parameters: slotParameters, result: type },
      });
    }
  }

  /**
   * Elaborates the field row of a record this module reached without importing
   * it, once, from the home module's declaration (Modules §4.2, #587).
   *
   * The rows this module builds eagerly come from `module.records`, and that
   * listing is the *importer's*: a nominal that arrives as an imported
   * function's result type — `make(1.5)` where nothing here names `Crate` — is
   * absent from it, so `#recordFields` held no entry and the fields the spec
   * calls open read as none. That is the whole of #587's first half: the
   * diagnostic enumerated an empty list because the list was empty.
   *
   * A no-op for everything already known, which is every record this module
   * declared or imported — so an importing module and a non-importing one now
   * elaborate the same row from the same declaration, which is §4.2's
   * import-insensitivity said operationally. Written to the same two maps the
   * eager pass writes, and in the same order (parameters before fields, since
   * the fields' annotations are read against them), so nothing downstream can
   * tell which pass filled them.
   *
   * Diagnostics are *not* suppressed, deliberately. A `->?` in a field of an
   * imported record is already re-read in every importing module, and the rule
   * being implemented here is that importing changes nothing: silencing the
   * reached case would put back, in the diagnostic channel, exactly the
   * import-sensitivity the ruling removes.
   */
  #materializeReachedRecord(record: Resolved.RecordId): void {
    if (this.#recordFields.has(record)) return;
    const declaration = this.#programRecord(record);
    if (declaration === undefined) return;
    const typeParameters = new Map(
      declaration.parameters.map((name) => [name, this.#fresh(0, false)] as const),
    );
    this.#recordParameters.set(record, typeParameters);
    this.#recordFields.set(
      record,
      this.#inPosition("record", () =>
        new Map(declaration.fields.map((field) => [
          field.name,
          this.#annotationType(field.annotation, 0, new Map(), typeParameters),
        ]))),
    );
  }

  /**
   * Whether this module may see a record's fields — Modules §4.1/§4.2.
   *
   * The stored `representationVisible` flag answers a narrower question: the
   * resolver stamps every imported copy `false` regardless of opacity, so it
   * means "this copy is the declaring module's own". Only `opaque`
   * hides fields (§4.2); a plain `export record` carries construction, `p.x`,
   * patterns, and update across the import (§4.1). So the home module always
   * sees, and everyone else sees exactly when the declaration is not opaque.
   *
   * A record in neither of this module's roles — neither declared here nor
   * imported here, reached only through some signature's type — is answered
   * from the program's own copy of the declaration, and `opaque` is read off it
   * directly (#587). The stored flag must **not** be consulted there: the copy
   * the program table holds is the home module's, where it is `true` by
   * definition, and honouring it would open every opaque record to precisely
   * the modules that never imported it. Absent even from the program table
   * there is no declaration to hide anything, and `true` is the lone-`check`
   * answer it has always been.
   *
   * `#checkPublicSignatures` still reads the raw flag, deliberately: there it
   * is the locality signal that keeps an imported type out of the
   * private-in-public check (§4.3).
   */
  #recordRepresentationVisible(record: Resolved.RecordId): boolean {
    const declaration = this.#records.get(record);
    if (declaration !== undefined) {
      return declaration.representationVisible || !declaration.opaque;
    }
    const home = this.#programRecord(record);
    return home === undefined || !home.opaque;
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
      case "JsSet":
        return this.#mentionsNode(actual.element);
      case "Nullable": return this.#mentionsNode(actual.value);
      case "Map":
      case "JsMap":
        return this.#mentionsNode(actual.key) || this.#mentionsNode(actual.value);
      case "Union":
      case "NominalRecord":
        return actual.arguments.some((argument) => this.#mentionsNode(argument));
      default: return false;
    }
  }

  /**
   * FFI Part 7 §11's one owned error (#478): a module that exports an exception
   * publishes the fixed generated face `isHexError` (Exceptions §7.6), and a
   * module-level declaration of that name has nowhere to go.
   *
   * `isHexError` is a **face**, deliberately outside Lexer §3.2's reserved
   * prefix, so it cannot be moved aside by the probe every generated name uses;
   * and the source's name cannot be moved aside silently, which is the whole of
   * the Part 8 §6.2 family's posture. So both sites are named and the fix is a
   * source rename. The family's two wordings are kept: an *exported* collision
   * asks for the export to be renamed, an unexported one for the declaration —
   * and both are errors here, because unlike a specialization the guard is
   * always public, so a private binding of the name would put two `isHexError`
   * declarations in one emitted module.
   *
   * The scan is over **every module-level name the emitted JavaScript binds**,
   * not over declarations alone: an import binds one too, and an aliased import
   * can choose any spelling. Modules §11.2 blesses the emitter renaming its own
   * generated needs, not a name the source chose — so this reports rather than
   * repairs, in either direction.
   */
  #checkGeneratedGuardCollision(items: readonly Resolved.Item[]): void {
    const exception = items.find(
      (item): item is Resolved.ExceptionItem => item.kind === "Exception" && item.exported,
    );
    if (exception === undefined) return;
    const named = (binding: Resolved.Binding): boolean => binding.name === IS_HEX_ERROR;
    for (const item of items) {
      const site: { readonly span: Source.Span; readonly exported: boolean } | undefined =
        (item.kind === "Let" || item.kind === "Fun" || item.kind === "Var") && named(item.binding)
          ? { span: item.span, exported: item.kind !== "Var" && item.exported }
          : item.kind === "LetPattern" && patternBindsGuardName(item.pattern)
          ? { span: item.span, exported: false }
          : item.kind === "ExternBlock"
          ? item.declarations
            .flatMap((declaration) =>
              declaration.kind !== "ExternType" && named(declaration.binding)
                ? [{ span: declaration.span, exported: declaration.exported }]
                : []
            )[0]
          : item.kind === "ConstraintDeclaration"
          ? item.members
            .flatMap((member) =>
              named(member.binding)
                ? [{ span: member.span, exported: item.exported }]
                : []
            )[0]
          // An **import** binds a module-level name in the emitted JavaScript
          // exactly as a declaration does, plain or aliased — `import { seed as
          // isHexError }` is the guard's name claimed by the source, and an
          // import line beside `export const isHexError = …` is a duplicate
          // declaration and a `SyntaxError` at load. The emitted binding is the
          // namespace alias or each named local (`moduleLevelBindings` in the
          // emitter is the same walk), so both forms are read here.
          //
          // Synthesized imports are skipped: those are the compiler's own
          // prelude line, not a name the source asked for, and a prelude export
          // of this name would be a compiler defect rather than a user error.
          : item.kind === "Import" && !item.synthesized && item.form.kind !== "Effect"
          ? (item.form.kind === "Namespace"
            ? [item.form.alias]
            : item.form.names.map(({ local }) => local))
            .flatMap((local) => local === IS_HEX_ERROR ? [{ span: item.span, exported: false }] : [])[0]
          : undefined;
      if (site === undefined) continue;
      this.#diagnostics.add({
        severity: "error",
        message: site.exported
          ? `generated guard \`${IS_HEX_ERROR}\` conflicts with exported \`${IS_HEX_ERROR}\`; rename the export`
          : `generated guard \`${IS_HEX_ERROR}\` conflicts with binding \`${IS_HEX_ERROR}\`; rename the declaration`,
        primary: site.span,
        labels: [{
          span: exception.span,
          message: `exported exception \`${exception.binding.name}\` requires the guard`,
        }],
      });
    }
  }

  /**
   * Constraints §4.6's spelling claim at the one seat the resolver could not
   * settle, and §4.7's signature check *(#541, form and unconditional claim
   * #546)*.
   *
   * Since #546 an ordinary binding of an honored member's spelling — exported
   * or private — is the rebinding error **unconditionally**: no export is
   * exempt, and the export grammar carries no exemption to read. The resolver
   * still lets exported ones past its own claim so that exactly one seat
   * reports them, and this is that seat, because one thing here still needs a
   * signature: an export that *would* have passed the door check earns the
   * mechanical rewrite into the form, and a signature is what decides that.
   *
   * A `widens` declaration is not an ordinary binding and is skipped here; its
   * own check is `#checkWidensDeclarations`.
   */
  #refuseExportedMemberSpellings(items: readonly Resolved.Item[]): void {
    const exported = new Map<string, Resolved.Item & { binding: Resolved.Binding }>();
    for (const item of items) {
      if (item.kind === "Let" && item.widens !== undefined) continue;
      if ((item.kind === "Let" || item.kind === "Fun") && item.exported) {
        exported.set(item.binding.name, item);
      }
    }
    if (exported.size === 0) return;
    // §4.6's **boundary**, where the prior refusals stand and the law is never
    // consulted: a spelling that is already an *ordinary binding* by another
    // route. Both seats are exactly these — the constraint's own declaring
    // module, where the spelling is the member's exported forwarder, and a
    // named constraint import, which brings the members as ordinary bindings
    // (Modules §3.1). The resolver has already refused the collision at the
    // binding, with the repair each seat owns; a second verdict here would say
    // the same thing twice and in the wrong words.
    const ordinaryElsewhere = new Set<string>();
    for (const item of items) {
      if (item.kind === "ConstraintDeclaration") {
        for (const member of item.members) ordinaryElsewhere.add(member.binding.name);
      }
      if (item.kind !== "Import" || item.form.kind !== "Named") continue;
      for (const { declaration } of item.constraints) {
        for (const member of declaration.members) {
          ordinaryElsewhere.add(member.binding.name);
        }
      }
    }
    for (const item of items) {
      if (item.kind !== "Honor") continue;
      const declaration = this.#constraintsByIdentity.get(item.constraintIdentity);
      const subject = this.#instanceSubjects.get(item);
      if (subject === undefined) continue;
      const instance = `${item.constraint}<${this.#display(subject)}>`;
      // The member list, with the wired fallback the resolver's claim also
      // carries for a compile with no declaration in view. A member reached
      // that way has no scheme to compare against, so it never earns the
      // rewrite — it takes the plain refusal, which is the claim's own verdict.
      const candidates: readonly (MemberCandidate | { readonly member: string })[] =
        declaration === undefined
          ? (PRE_REGISTERED_CONSTRAINT_MEMBERS[item.constraint] ?? [])
            .map((member) => ({ member }))
          : constraintMemberCandidates(declaration);
      for (const candidate of candidates) {
        if (ordinaryElsewhere.has(candidate.member)) continue;
        const door = exported.get(candidate.member);
        if (door === undefined) continue;
        // The claim's own two forms, so the primary lands on the later of the
        // two exactly as §4.6's refusal does.
        const bound = door.binding.span;
        const rewrite = "symbol" in candidate &&
            this.#generalises(door.binding.symbol, candidate, subject, item.span)
          ? "a member's wider face is declared, not exported — write " +
            `\`widens ${moduleAlias(item.constraint)}.${candidate.member}(…)\` ` +
            `and account for the member with \`${candidate.member} = widened\`.`
          : "Hexagon does not allow rebinding — choose a different name.";
        const claimFirst = item.span.start.offset < bound.start.offset;
        this.#diagnostics.add({
          severity: "error",
          message: claimFirst
            ? `\`${candidate.member}\` is already bound: the \`${instance}\` ` +
              `instance binds it as a member (line ${item.span.start.line + 1}); ${rewrite}`
            : `the \`${instance}\` instance binds \`${candidate.member}\`, which ` +
              `is already bound (line ${bound.start.line + 1}); ${rewrite}`,
          primary: claimFirst ? bound : item.span,
          labels: claimFirst
            ? [{ span: item.span, message: "the member is bound here" }]
            : [{ span: bound, message: "previous binding" }],
        });
      }
    }
  }

  /**
   * Constraints §4.7's signature check, at the declaration.
   *
   * The check runs **per listed member** — a list-form declaration has one body
   * and as many restrictions as it names — and a failure is reported as a
   * failed *door*, naming the seat, never as a name collision: the keyword has
   * already declared which of the two the author meant.
   */
  #checkWidensDeclarations(items: readonly Resolved.Item[]): void {
    const honored = new Map<string, Resolved.HonorItem>();
    for (const item of items) {
      if (item.kind === "Honor") honored.set(item.constraintIdentity, item);
    }
    for (const item of items) {
      if (item.kind !== "Let" || item.widens === undefined) continue;
      for (const target of item.widens) {
        const honor = honored.get(target.constraintIdentity);
        if (honor === undefined) continue;
        const subject = this.#instanceSubjects.get(honor);
        const declaration = this.#constraintsByIdentity.get(target.constraintIdentity);
        const candidate = declaration === undefined
          ? undefined
          : constraintMemberCandidates(declaration)
            .find(({ member }) => member === target.member);
        if (subject === undefined || candidate === undefined) continue;
        const failure = this.#widensFailure(
          item.binding.symbol,
          candidate,
          subject,
          item.span,
        );
        if (failure === undefined) continue;
        this.#failedWidens.add(`${target.constraintIdentity} ${target.member}`);
        this.#diagnostics.add({
          severity: "error",
          message:
            `this declaration does not widen \`${target.module}.${target.member}\`: ` +
            failure,
          primary: target.span,
        });
      }
    }
  }

  /**
   * Why a `widens` declaration fails to widen one member, or `undefined` if it
   * widens it properly (Constraints §4.7's check, §4.6's statement of it).
   *
   * Same arity, same subject seat, same result; every remaining member
   * parameter accepted at the declaration's corresponding seat exactly or
   * through Numeric Literals §5.1's exact conversions; and **at least one seat
   * properly wider**, because an identical signature generalises nothing and is
   * exactly the delegation pattern §4.6 rules ill-formed. The "at least one" is
   * a floor, not a ceiling: several seats may widen at once.
   */
  #widensFailure(
    door: Resolved.SymbolId,
    candidate: MemberCandidate,
    subject: Mono,
    span: Source.Span,
  ): string | undefined {
    const doorScheme = this.#schemes.get(door);
    const memberScheme = this.#schemes.get(candidate.symbol);
    if (doorScheme === undefined || memberScheme === undefined) {
      return "its signature could not be read";
    }
    // Both copies are fresh, so the pinning unification below binds only the
    // copy's own variables and nothing this check can observe elsewhere.
    const wider = this.#prune(this.#instantiate(doorScheme, 0, undefined, span));
    const member = this.#prune(
      this.#instantiate(memberScheme, 0, undefined, span, subject),
    );
    if (wider.kind !== "Function" || member.kind !== "Function") {
      return "a door is a function of the member's seats";
    }
    if (wider.parameters.length !== member.parameters.length) {
      const seats = member.parameters.length;
      return `the member takes ${seats} parameter${seats === 1 ? "" : "s"}, ` +
        `this declaration ${wider.parameters.length}`;
    }
    const [memberSubject, ...rest] = member.parameters;
    const [doorSubject] = wider.parameters;
    if (memberSubject === undefined || doorSubject === undefined) {
      return "a door is a function of the member's seats";
    }
    if (!this.#sameSeat(memberSubject, doorSubject)) {
      return `the subject seat is \`${this.#display(memberSubject)}\`, not ` +
        `\`${this.#display(doorSubject)}\` — a door widens across seats at one ` +
        "type, never across types";
    }
    if (!this.#sameSeat(member.result, wider.result)) {
      return `the result is \`${this.#display(member.result)}\`, not ` +
        `\`${this.#display(wider.result)}\` — the member is this ` +
        "declaration's restriction, and a wider result could not restrict back";
    }
    let widened = false;
    for (const [offset, from] of rest.entries()) {
      const to = wider.parameters[offset + 1]!;
      if (this.#sameSeat(from, to)) continue;
      if (!this.#acceptsExactly(from, to)) {
        return `\`${this.#display(from)}\` does not reach the seat ` +
          `\`${this.#display(to)}\` exactly`;
      }
      widened = true;
    }
    if (!widened) return "an identical signature generalises nothing";
    return undefined;
  }

  /**
   * Whether one term properly generalises one constraint member at a given
   * subject — the law's signature half (#541), asked now only where a *refused*
   * binding might have earned the rewrite into the `widens` form (§4.7).
   */
  #generalises(
    door: Resolved.SymbolId,
    candidate: MemberCandidate,
    subject: Mono,
    span: Source.Span,
  ): boolean {
    return this.#widensFailure(door, candidate, subject, span) === undefined;
  }

  /**
   * Whether a value at one seat's type reaches another seat exactly — the same
   * type, or Numeric Literals §5.1's two conversions, which are the only exact
   * ones the language has.
   */
  #acceptsExactly(from: Mono, to: Mono): boolean {
    if (this.#sameSeat(from, to)) return true;
    const source = this.#prune(from);
    if (source.kind !== "Constructor") return false;
    if (source.name === "Nat") return this.#supportsNumericTarget(to);
    if (source.name === "Int") return this.#supportsSignedTarget(to);
    return false;
  }

  /**
   * Type equality as the generalisation law needs it: **conservative**, so a
   * shape it does not recognise answers "not the same" and the exemption is
   * simply not granted. The law is a permission, and a permission decided by a
   * guess is worse than one withheld.
   */
  #sameSeat(left: Mono, right: Mono): boolean {
    const first = this.#prune(left);
    const second = this.#prune(right);
    if (first === second) return true;
    if (first.kind !== second.kind) return false;
    if (first.kind === "Constructor" && second.kind === "Constructor") {
      return first.name === second.name;
    }
    if (first.kind === "NominalRecord" && second.kind === "NominalRecord") {
      return first.record === second.record &&
        first.arguments.length === second.arguments.length &&
        first.arguments.every((argument, index) =>
          this.#sameSeat(argument, second.arguments[index]!)
        );
    }
    if (first.kind === "Union" && second.kind === "Union") {
      return first.union === second.union &&
        first.arguments.length === second.arguments.length &&
        first.arguments.every((argument, index) =>
          this.#sameSeat(argument, second.arguments[index]!)
        );
    }
    if (first.kind === "Variable" && second.kind === "Variable") {
      return first.id === second.id;
    }
    return false;
  }

  #checkPublicSignatures(items: readonly Resolved.Item[]): void {
    this.#checkGeneratedGuardCollision(items);
    const publicUnions = new Set(items.flatMap((item) => item.kind === "Union" && item.exported ? [item.union] : []));
    const publicRecords = new Set(items.flatMap((item) => item.kind === "RecordDeclaration" && item.exported ? [item.record] : []));
    // Each private nominal the walk finds, by name, against the span of the
    // declaration keeping it private — where §4.3's secondary label points, which
    // is also exactly where the one-keyword fix goes.
    //
    // All three nominal arms are **local**: they fire only on a declaration this
    // module itself withholds. A record or union asks `representationVisible`,
    // stamped false on every imported copy (`#materializeReachedUnion`); an
    // extern type asks this module's own `#externTypes`, whose imported entries
    // are exported by construction — the interface publishes no other kind. So a
    // type that lives elsewhere contributes nothing here whatever its privacy at
    // home, and the restraint leaves nothing unguarded. Every route into a
    // consumer's face runs through some exported face of the home module — a
    // carrier, a binding, or a constraint's member signatures (#626) — and every
    // one is refused **there** (#629), in the one module that holds the
    // declaration the label points at and can perform the remedy the message
    // names. The unnameability backstop stands behind that: a consumer cannot
    // name the type, so no complete exported signature of its own (§4.1.1) could
    // mention it regardless. Locality is therefore also what makes the span
    // total: every firing has a declaration in this file, so every diagnostic in
    // the family carries its label, and none points across files (§4.2.1).
    type Mentions = Map<string, Source.Span>;
    const visit = (type: Mono, found: Mentions = new Map()): ReadonlyMap<string, Source.Span> => {
      const actual = this.#prune(type);
      if (actual.kind === "Union") {
        const declaration = this.#unions.get(actual.union);
        if (!publicUnions.has(actual.union) && declaration?.representationVisible) {
          found.set(actual.name, declaration.span);
        }
        actual.arguments.forEach((argument) => visit(argument, found));
      } else if (actual.kind === "NominalRecord") {
        const declaration = this.#records.get(actual.record);
        if (!publicRecords.has(actual.record) && declaration?.representationVisible) {
          found.set(actual.name, declaration.span);
        }
        actual.arguments.forEach((argument) => visit(argument, found));
      } else if (actual.kind === "ExternType") {
        const declaration = this.#externTypes.get(actual.externType);
        if (declaration !== undefined && !declaration.exported) {
          found.set(actual.name, declaration.span);
        }
      } else if (actual.kind === "Function") {
        actual.parameters.forEach((parameter) => visit(parameter, found));
        visit(actual.result, found);
      } else if (actual.kind === "Tuple") actual.elements.forEach((element) => visit(element, found));
      else if (actual.kind === "Record") actual.fields.forEach((field) => visit(field, found));
      else if (
        actual.kind === "Vector" || actual.kind === "Set" || actual.kind === "Array" ||
        actual.kind === "JsSet" || actual.kind === "Node"
      ) visit(actual.element, found);
      else if (actual.kind === "Nullable") visit(actual.value, found);
      else if (actual.kind === "Map" || actual.kind === "JsMap") { visit(actual.key, found); visit(actual.value, found); }
      return found;
    };
    /**
     * One member of Modules §4.3's message family: the carrier's own noun in
     * both seats, the primary at the offending seat, and the secondary label at
     * the private type's declaration.
     */
    const exposes = (
      noun: string,
      keep: string,
      carrier: string,
      exposed: string,
      declaration: Source.Span,
      primary: Source.Span,
    ): void => {
      this.#diagnostics.add({
        severity: "error",
        message: `exported ${noun} \`${carrier}\` exposes private type \`${exposed}\`; ` +
          `export the type, perhaps opaquely, or keep the ${keep} private`,
        primary,
        labels: [{ span: declaration, message: `\`${exposed}\` is declared private here` }],
      });
    };
    /**
     * A **type** carrier's seats — and an exported constraint's member
     * signatures, the one member of the family that is no carrier (#626) — read
     * in declaration order, each named type reported **once** at the first seat
     * that reaches it (§4.3): three fields of one private type draw one
     * diagnostic, a carrier leaking two draw two. The seat is the carrier's
     * whole written annotation, never a nested occurrence's sub-annotation — a
     * field `token: Vector(Token)` anchors at `Vector(Token)` — which is what
     * makes the seat the annotation's own span rather than anything the walk
     * found inside it.
     *
     * A seat whose type is missing is skipped rather than guessed at: the row is
     * absent only where elaboration already failed and said so.
     */
    const carrier = (
      noun: string,
      keep: string,
      name: string,
      seats: readonly { readonly type: Mono | undefined; readonly span: Source.Span }[],
    ): void => {
      const reported = new Set<string>();
      for (const seat of seats) {
        if (seat.type === undefined) continue;
        for (const [exposed, declaration] of visit(seat.type)) {
          if (reported.has(exposed)) continue;
          reported.add(exposed);
          exposes(noun, keep, name, exposed, declaration, seat.span);
        }
      }
    };
    /** The slot types of a constructor's scheme, index-aligned with its slots. */
    const slotTypes = (symbol: Resolved.SymbolId): readonly Mono[] => {
      const type = this.#prune(this.#scheme(symbol).type);
      return type.kind === "Function" ? type.parameters : [];
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
        // A binding reports at the binding, whose signature is one seat already
        // (§4.3) — the family's one anchor that is not an annotation.
        for (const [name, declaration] of visit(signature)) {
          exposes("binding", "binding", binding.name, name, declaration, binding.span);
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
      // The four **type** carriers (#621), read beside the bindings above, each
      // gated on the head's own `export` — never on `opaque`. That second half
      // is load-bearing where a head can take the keyword: an `opaque` item
      // carries `exported: true` here, and its interior is no carrier at all —
      // FFI Part 7 §5's brand-only face mentions neither a field nor a payload,
      // so a private nominal inside one leaks nothing, and hiding a private
      // representation behind an opaque name is §4.2's intended idiom. `type`
      // and `exception` heads take no `opaque` (§4.2), so those two read
      // `exported` alone.
      if (item.kind === "TypeAlias" && item.exported) {
        carrier("type alias", "alias", item.name, [
          { type: this.#aliasTarget(item), span: item.annotation.span },
        ]);
      }
      if (item.kind === "RecordDeclaration" && item.exported && !item.opaque) {
        const fields = this.#recordFields.get(item.record);
        carrier("record", "record", item.name, item.fields.map((field) => ({
          type: fields?.get(field.name),
          span: field.annotation.span,
        })));
      }
      if (item.kind === "Union" && item.exported && !item.opaque) {
        carrier("union", "union", item.name, item.constructors.flatMap((constructor) => {
          const types = slotTypes(constructor.binding.symbol);
          return constructor.slots.map((slot, index) => ({
            type: types[index],
            span: slot.annotation.span,
          }));
        }));
      }
      if (item.kind === "Exception" && item.exported) {
        const types = slotTypes(item.binding.symbol);
        carrier("exception", "exception", item.binding.name, item.slots.map((slot, index) => ({
          type: types[index],
          span: slot.annotation.span,
        })));
      }
      // The family's sixth member, and its only **non-carrier** (#626): an
      // exported constraint's member signatures. No `.d.ts` row of its own
      // rides FFI Part 7's carrier list, so the four blocks above cannot reach
      // it — and the refusal stands on two legs (§4.3). The one that never was
      // the emitter's: the rationale reads a member signature verbatim — an
      // honor abroad must produce what the signature names, a member call hands
      // it back, and neither party can name or use the type. And the emitter's
      // after all: member signatures do reach a declaration file, through Parts
      // 8–9's deliberate surfaces — the public-evidence closure's
      // `Constraint.Dictionary<a>` interface renders the member set with the
      // members' boundary faces (FFI Part 9 §2.2; Modules §11.5) — and a
      // private nominal there is exactly #621's failure class, a published face
      // naming what no file binds, guarded here before it can arise.
      //
      // Read with the same walk, so locality and the opaque exemption are
      // inherited rather than restated, and through the same `carrier` helper,
      // so the dedupe is the family's — once per (constraint, type), at the
      // first offending member in written order.
      //
      // Three scope lines, all normative:
      //  * **Member signatures only.** A member's whole written signature is one
      //    seat — a binding in miniature — which is what `member.span` is: the
      //    name through the return annotation, stopping before any `=`. Default
      //    **bodies** are bodies, not faces, and stay free (a default may use its
      //    module's private bindings; Constraints §6.5), as instances are (§7.4).
      //  * **Constraints are not type mentions.** A base constraint on the head,
      //    or a constraint in any binder list, crosses nothing — the constraint
      //    is the gate, not the cargo. A *private* constraint gating an exported
      //    binding is the lawful sealing idiom, stated deliberately; the binding
      //    rule above is untouched.
      //  * **Unexported constraints are not visited**, exactly as a private
      //    carrier is not: only an exported face shows anybody anything.
      if (item.kind === "ConstraintDeclaration" && item.exported) {
        carrier("constraint", "constraint", item.name, item.members.map((member) => ({
          type: this.#schemes.get(member.binding.symbol)?.type,
          span: member.span,
        })));
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
      // Extern is the foreign boundary; `Node` can never cross it, exported or
      // not. The **intrinsic door is not that boundary** (#365): its implementer
      // is the compiler, which owns `Node`'s representation because it emits it,
      // so there is no unknown foreign consumer for the hidden type to leak to.
      // That is `spec/intrinsics.md` §3.4's argument for genericity, applied to
      // the same premise — and the door is reachable only from privileged
      // source, which for `Node` means a runtime module: nowhere else can even
      // spell the type. `runtime/HashTrie.hex`'s packed-storage rows are the
      // first to take it.
      if (item.kind === "ExternBlock" && !item.intrinsic) {
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

  /**
   * Each recorded hole, read back once inference has finished with it.
   *
   * The scheme quantifies whatever variables are still unsolved, so a hole the
   * body fixed reads `Int` and one nothing fixed reads `a` — which is what the
   * enclosing binding's own scheme shows at that position. It is not the
   * binding's scheme, though: a hole under a `var`, or one the value restriction
   * declined, is unsolved without being quantified anywhere, and displaying it
   * as a variable is still the honest answer.
   *
   * Deduplicated by span, first writer winning. Elaboration now records one
   * entry per *written* hole (§4.1's rule, memoized in `#annotationType`), so
   * this no longer collapses anything in practice; it is kept as the guard that
   * hover answers one caret once, whatever later re-elaborates an annotation.
   */
  #materializeTypeHoles(): readonly Typed.TypeHole[] {
    const holes = new Map<string, Typed.TypeHole>();
    for (const { span, type } of this.#typeHoles) {
      const key = `${Number(span.fileId)}:${span.start.offset}:${span.end.offset}`;
      if (holes.has(key)) continue;
      holes.set(key, {
        span,
        scheme: this.#publicScheme({ variables: this.#collectVariables(type), type }),
      });
    }
    return [...holes.values()];
  }

  /**
   * The total-contract fence (closure doc §5.4): a hole is an inference
   * instrument, and these surfaces are checked against no body from which one
   * could be filled — or, at an export, the completeness requirement *is* the
   * point and a hole would un-write part of the module's contract.
   *
   * Run before anything elaborates an annotation, so the fence speaks first: an
   * `extern fun f(x: _)` is refused here rather than reaching the generic-extern
   * refusal, which asks a different question and would name the wrong rewrite.
   *
   * Only signatures. An exported function's *body* is an inference surface like
   * any other, so a `let n: _ = 42` inside one stays legal.
   */
  #rejectTypeHoles(module: Resolved.Module): void {
    const reject = (
      annotation: Resolved.TypeAnnotation | undefined,
      message: string,
    ): void => {
      if (annotation === undefined) return;
      for (const span of typeAnnotationHoles(annotation)) {
        this.#diagnostics.add({ severity: "error", message, primary: span });
      }
    };
    const declaration = (article: "a" | "an", form: string): string =>
      `${article} \`${form}\` declaration writes its types in full; replace \`_\` with the intended type`;
    const signature = (lambda: Resolved.LambdaExpr): void => {
      for (const parameter of lambda.parameters) reject(parameter.annotation, EXPORTED_SIGNATURE);
      reject(lambda.returnAnnotation, EXPORTED_SIGNATURE);
    };

    for (const item of module.items) {
      switch (item.kind) {
        case "TypeAlias":
          reject(item.annotation, declaration("a", "type"));
          break;
        case "RecordDeclaration":
          for (const field of item.fields) reject(field.annotation, declaration("a", "record"));
          break;
        case "Union":
          for (const constructor of item.constructors) {
            for (const slot of constructor.slots) reject(slot.annotation, declaration("a", "union"));
          }
          break;
        // §5.4's `exception` slot-types row: written types checked against no
        // body, where an unsolved variable would seat silently.
        case "Exception":
          for (const slot of item.slots) reject(slot.annotation, declaration("an", "exception"));
          break;
        case "ExternBlock":
          // Every FFI declaration form, the intrinsic door included: §3.4 of
          // `spec/intrinsics.md` grants the door *genericity*, which a hole is
          // not (closure doc §2.3), and the door is still a declaration surface.
          for (const external of item.declarations) {
            if (external.kind === "ExternFun") {
              for (const parameter of external.parameters) {
                reject(parameter.annotation, declaration("an", "extern"));
              }
              reject(external.returnAnnotation, declaration("an", "extern"));
            } else if (external.kind === "ExternLet") {
              reject(external.annotation, declaration("an", "extern"));
            }
          }
          break;
        case "ConstraintDeclaration":
          // Member *signatures* only. A member's default value is an ordinary
          // body, and its annotations are inference-checked like any other's.
          for (const member of item.members) {
            for (const parameter of member.parameters) {
              reject(parameter.annotation, declaration("a", "constraint"));
            }
            reject(member.returnAnnotation, declaration("a", "constraint"));
          }
          break;
        case "Honor":
          // §5.4's instance-head row, which owns its own §6.3 wording: an
          // instance keyed on an unsolved variable is exactly what coherence
          // cannot have. The subject's *arguments* are inside its annotation, so
          // `honor Show<Vector(_)>` is reached by the same walk.
          reject(
            item.subject,
            "an `honor` declaration names its subject in full; replace `_` with the intended type",
          );
          // §5.4's implied-type-choices row, which is the same sentence again:
          // an unsolved projection would be silent.
          for (const implied of item.impliedTypes) {
            reject(implied.annotation, declaration("an", "honor"));
          }
          break;
        case "Let":
          if (!item.exported) break;
          reject(item.annotation, EXPORTED_SIGNATURE);
          if (item.value.kind === "Lambda") signature(item.value);
          break;
        case "Fun":
          if (!item.exported) break;
          signature(item.value);
          break;
        default:
          break;
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
      // Absorption is decided identity-side, and so is *every* step after it:
      // `#keptRequirements` returns the entailment-maximal set keyed on
      // declarations, and each survivor is then spelled by the form that
      // resolves here to the declaration it names (§5.1.1's advised-spelling
      // law, Modules §4.1.1). The name-side sieve used to run over the result
      // and did two things wrong at once (#715, #716): it resolved each *word*
      // through this module's scope, so a same-spelled local shadow's bases
      // absorbed a genuine binder, and it deduplicated by word, so two distinct
      // declarations sharing one printed as one — a binder no author could
      // write, for a pair one word cannot declare.
      const required = this.#keptRequirements(variable);
      if (required.length === 0 || variable.declaredConstraints !== undefined) return;
      const spellings = this.#constraintSpellings(required);
      // §5.1.1's fourth tier, Modules §4.1.1's own paragraph: a required
      // constraint with no spelling and no route is the §4.3 sealing gate seen
      // from outside, and no complete signature exists to advise. The report
      // states the gate and the exits instead — an impossible fixit would be
      // worse than none.
      const sealed = spellings.find((spelling) => spelling.kind === "sealed");
      if (sealed !== undefined) {
        const home = this.#constraintHomePath(sealed.identity);
        // The exits, in the order the reader can act on them. The first names
        // no *call*: `demandedBy` holds the `fun` member whose body raised the
        // demand — the function under report itself, or a sibling under one
        // head — and never the operation that demanded it, so naming it would
        // tell the author to call the very thing being refused. The constrained
        // operation is what has to go concrete, and the message says so without
        // guessing which one it was.
        const exits = [
          "use the constrained operation at a concrete type",
          `keep \`${item.binding.name}\` private`,
          // Only where the gate is a stated fact about a file that exists: the
          // exit is an edit in that file, and there is none to offer otherwise.
          ...(sealed.unexported && home !== undefined
            ? [`export \`${sealed.name}\` from \`${home}\``]
            : []),
        ];
        this.#diagnostics.add({
          severity: "error",
          message:
            `exported function \`${item.binding.name}\` requires ` +
            `${this.#sealedConstraintMention(sealed)}; ` +
            "a complete signature cannot be written here — " +
            `${exits.slice(0, -1).join(", ")}, or ${exits.at(-1)}`,
          primary: item.binding.span,
          // No `incompleteSignature` marker, deliberately. It exists so a
          // signature-writing repair can tell the *absence* of what it writes
          // from the reasons not to write it (`Diagnostics.Diagnostic`), and at
          // this seat there is nothing to write: the fourth tier's whole claim
          // is that no complete signature exists here. Marking it would offer
          // the return-annotation action over a declaration it cannot complete.
        });
        return;
      }
      const constraintList = spellings.length === 1
        ? spellingText(spellings[0]!)
        : `(${spellings.map(spellingText).join(", ")})`;
      const binder = `${variable.rigidName ?? inferredTypeVariableName(index)}: ${constraintList}`;
      // *(#700.)* The advice follows the spelling (Modules §4.1.1): a member
      // of a `fun` block writes its binders on the **head**, and a per-member
      // binder is refused — so offering one here would be the Rewrite Rule's
      // own failure, an advised repair the next compile rejects.
      this.#diagnostics.add({
        severity: "error",
        message:
          `exported function \`${item.binding.name}\` must declare every constraint in its signature; ` +
          (item.kind === "Fun" && item.block !== undefined
            ? `declare the constraint on the block head: \`fun<${binder}>\``
            : `write \`<${binder}>\``) +
          // This message has named no declaring module, so the clauses stand
          // whole (§5.1.1's elision licence, read the other way).
          this.#constraintRouteClauses(spellings, true),
        primary: item.binding.span,
        incompleteSignature: true,
      });
    });

    // A block member's binders are the head's (Modules §4.1.1), so the head's
    // list takes the maximality check every written list takes — **once per
    // block**, not once per exporting member. The list is one written thing at
    // one span, so a second report would repeat the first word for word and
    // caret the same characters; two exporting members produced two, three
    // produced three.
    const head = item.kind === "Fun" ? item.block : undefined;
    const headBinders = head !== undefined && !this.#checkedBlockHeads.has(head.id)
      ? (this.#checkedBlockHeads.add(head.id), head.typeParameters ?? [])
      : [];
    for (const parameter of [...(lambda.typeParameters ?? []), ...headBinders]) {
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
      // Functions §8 item 2's read-through, extended by Ascription §3: an
      // ascription of a syntactic value is a syntactic value. It wraps; it does
      // not evaluate, so `let id = (x => x : a -> a)` generalizes exactly as
      // `let id = (x => x)` does.
      case "Ascription":
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
      const effect = actual.effect === undefined ? undefined : this.#prune(actual.effect);
      return {
        kind: "Function",
        parameters: actual.parameters.map((parameter) =>
          this.#publicType(parameter, seen),
        ),
        result: this.#publicType(actual.result, seen),
        // Modules §4.1.1: the exported signature is the contract, so the colour
        // has to cross the border with it — a linked `->?` as its variable, the
        // constant as `"impure"`, and the pure constant as nothing at all.
        ...(effect === undefined || (effect.kind === "Effect" && !effect.impure)
          ? {}
          : {
            effect: effect.kind === "Effect"
              ? "impure" as const
              : { variable: Typed.typeVariableId((effect as Variable).id) },
          }),
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
    // The qualifier crosses into the published type with the identity it sits
    // on: the declaration emitter reads a *published* scheme, so a qualifier
    // dropped here would be a qualifier that never reached a face.
    if (actual.kind === "Union") {
      return {
        kind: "Union",
        union: actual.union,
        name: actual.name,
        arguments: actual.arguments.map((argument) => this.#publicType(argument, seen)),
        ...(actual.qualifier === undefined ? {} : { qualifier: actual.qualifier }),
      };
    }
    if (actual.kind === "NominalRecord") {
      return {
        kind: "NominalRecord",
        record: actual.record,
        name: actual.name,
        arguments: actual.arguments.map((argument) => this.#publicType(argument, seen)),
        ...(actual.qualifier === undefined ? {} : { qualifier: actual.qualifier }),
      };
    }
    if (actual.kind === "ExternType") {
      return {
        kind: "ExternType",
        externType: actual.externType,
        name: actual.name,
        ...(actual.qualifier === undefined ? {} : { qualifier: actual.qualifier }),
      };
    }
    if (actual.kind === "Range") return { kind: "Range" };
    if (actual.kind === "Vector") {
      return { kind: "Vector", element: this.#publicType(actual.element, seen) };
    }
    if (actual.kind === "Set") return { kind: "Set", element: this.#publicType(actual.element, seen) };
    if (actual.kind === "Array") return { kind: "Array", element: this.#publicType(actual.element, seen) };
    if (actual.kind === "JsSet") return { kind: "JsSet", element: this.#publicType(actual.element, seen) };
    if (actual.kind === "Node") return { kind: "Node", element: this.#publicType(actual.element, seen) };
    if (actual.kind === "Nullable") return { kind: "Nullable", value: this.#publicType(actual.value, seen) };
    if (actual.kind === "Map") {
      return { kind: "Map", key: this.#publicType(actual.key, seen), value: this.#publicType(actual.value, seen) };
    }
    if (actual.kind === "JsMap") {
      return { kind: "JsMap", key: this.#publicType(actual.key, seen), value: this.#publicType(actual.value, seen) };
    }
    // An effect constant is reached only through a function's effect slot,
    // which the `Function` arm renders itself; it is never a type in its own
    // right, and there is no public spelling for one.
    if (actual.kind === "Effect") return { kind: "Error" };
    const existing = seen.get(actual.id);
    if (existing !== undefined) return existing;
    const variable: Typed.VariableType = {
      kind: "Variable",
      id: Typed.typeVariableId(actual.id),
    };
    seen.set(actual.id, variable);
    return variable;
  }

  /**
   * The name a constraint's own **declaration** gives it, which is the name
   * every module agrees on.
   *
   * Diagnostics print the spelling the source used — that is what the reader
   * wrote — but an evidence parameter is *named* after the constraint, and the
   * spelling is no longer a property of the constraint once modules can rename
   * one at the border: a function under `<a: Heft>` receives its dictionary as
   * `Heft`'s while the imported member it calls demands `Weigh`'s, and the two
   * are one constraint. Canonicalizing here, at the Typed boundary, is what
   * keeps the two sides spelling one parameter alike without putting the alias
   * into the output.
   *
   * Which *evidence seat* a demand reads is decided by identity and never by
   * this word, so two distinct constraints sharing a name take two seats and
   * the parameters spelled for them differ by a numeric suffix alone. No module
   * can spell both under that one word, but one reaches both whenever their
   * imported schemes meet, and can spell both by aliasing an import.
   *
   * A **base constraint's dictionary slot** is a second question this function
   * answers a part of, and it has one seat: `#baseConstraintSlots` canonicalizes
   * each entry of a declaration's base list here and then mints the slots
   * through `mintBaseConstraintSlots`, and both the honor block that writes a
   * slot and the entailment path that reads one go through it (§6.2). Nothing
   * else may turn a constraint name into a slot — the residue this comment used
   * to record was exactly that: two sides minting from two names, parted by an
   * importer's alias (#718).
   */
  #canonicalConstraintName(
    name: Typed.ConstraintName,
    identity: string,
  ): Typed.ConstraintName {
    return this.#constraintsByIdentity.get(identity)?.name ?? name;
  }

  #publicRequirement(requirement: Requirement): Typed.Constraint {
    return {
      name: this.#canonicalConstraintName(requirement.name, requirement.identity),
      identity: requirement.identity,
      type: this.#publicType(requirement.type),
      span: requirement.span,
      ...(requirement.dictionary === undefined
        ? {}
        : { dictionary: requirement.dictionary }),
      ...(requirement.reported && requirement.dictionary === undefined
        ? { unsatisfied: true }
        : {}),
      ...this.#requirementRoute(requirement),
      ...(requirement.dictionaryArguments === undefined
        ? {}
        : { dictionaryArguments: requirement.dictionaryArguments.map((argument) =>
            this.#publicRequirement(argument)
          ) }),
      ...(requirement.structural === true ? { structural: true } : {}),
      ...(requirement.components === undefined
        ? {}
        : { components: this.#publicComponents(requirement.components) }),
    };
  }

  /**
   * How a demand on a still-generic type reaches the evidence actually passed:
   * the binder it projects out of, and the slot path down from that binder to
   * the constraint demanded. Empty when the demand *is* a binder — it is then
   * handed over whole — and empty when nothing in scope entails it, which only
   * a module already carrying a diagnostic can reach; emission best-efforts
   * there rather than compounding the report.
   *
   * Derived here and never earlier. Two demands for one constraint on one
   * variable are one seat, so only the first of them joins the variable's list,
   * and the surviving binders keep changing as later demands absorb earlier
   * ones — a route worked out when a demand arrived would describe a binder set
   * that no longer exists by the time the scheme closes. The requirement object
   * an expression's elaboration is holding may be either the resident or one of
   * the dropped duplicates, and both have to publish the same route.
   *
   * A satisfied requirement carries an instance instead, and a structural one
   * carries its components; neither projects out of a binder.
   */
  #requirementRoute(
    requirement: Requirement,
  ): {
    readonly evidenceConstraint?: Typed.ConstraintName;
    readonly evidenceConstraintIdentity?: string;
    readonly evidencePath?: readonly string[];
  } {
    if (requirement.dictionary !== undefined || requirement.structural === true) {
      return {};
    }
    const variable = this.#prune(requirement.type);
    if (variable.kind !== "Variable") return {};
    const kept = this.#keptRequirements(variable);
    if (kept.some(({ identity }) => identity === requirement.identity)) return {};
    // List order, so a variable carrying two binders that both entail the demand
    // — neither absorbing the other — routes through the same one every compile.
    for (const member of kept) {
      const path = this.#entailmentPath(member.identity, requirement.identity);
      if (path === undefined) continue;
      return {
        evidenceConstraint: this.#canonicalConstraintName(member.name, member.identity),
        evidenceConstraintIdentity: member.identity,
        evidencePath: path,
      };
    }
    return {};
  }

  /** #278: the component selection, in the order the container enumerates it. */
  #publicComponents(
    components: readonly RequirementComponent[],
  ): readonly Typed.ConstraintComponent[] {
    return components.map(({ key, requirement }) => ({
      key,
      constraint: this.#publicRequirement(requirement),
    }));
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
   * Deliberately *not* `#keptRequirements`, the test `#publicScheme` uses.
   * That one asks whether a requirement keeps a seat on **its variable**, and a
   * projection loses that test while still being an argument — `Same` reached
   * as `__dictLabeled.same` sits on a variable whose binder is `Labeled`, and it
   * is nonetheless the callee's one real argument. Elimination here has to be
   * decided among the *siblings a reference supplies*, not per requirement.
   *
   * Both decisions — which requirements are siblings, and which of the survivors
   * are the same argument — are made per ABI **slot** and never per resolved
   * type; see `#evidenceSlot` for why the distinction is the whole of #443.
   */
  #evidenceRequirements(requirements: readonly Requirement[]): readonly Typed.Constraint[] {
    // Siblings are gathered by constraint *declaration*, so two same-named but
    // unrelated constraints on one variable stay two arguments (§5.1.1) — and by
    // ABI *slot*, so two distinct variables that landed on one type stay two
    // arguments as well (#443).
    const siblingsBySlot = new Map<string, Set<string>>();
    for (const requirement of requirements) {
      const key = this.#evidenceSlot(requirement);
      const constraints = siblingsBySlot.get(key) ?? new Set<string>();
      constraints.add(requirement.identity);
      siblingsBySlot.set(key, constraints);
    }
    return this.#publicRequirements(requirements.filter((requirement) => {
      const siblings = siblingsBySlot.get(this.#evidenceSlot(requirement)) ?? new Set<string>();
      for (const sibling of siblings) {
        if (sibling === requirement.identity) continue;
        if (this.#entailmentPath(sibling, requirement.identity) !== undefined) return false;
      }
      return true;
    }));
  }

  /**
   * Which of the callee's evidence slots a requirement answers: the scheme
   * variable `#instantiate` copied it onto, named by the fresh variable that
   * copy minted (#443).
   *
   * The slot is *not* the type the variable resolved to. `dictionaryEntries`
   * gives the callee one parameter per constrained variable, so two variables
   * that unify to one type — `pair<a: Show, b: Show>` called as `pair(2, 3)` —
   * still have two slots, and keying on the resolved type merged them into one
   * argument against a two-parameter callee: a clean compile that read `.show`
   * off `undefined`. Sharing belongs to the *value* each slot references, which
   * for a prelude instance is one named module constant, so the correct emission
   * is that name written once per slot.
   *
   * Read unpruned deliberately. The fresh variable keeps its identity after
   * unification, which is what makes `both<c: Show>(y: c) = pair(y, y)` — two
   * slots, one dictionary — come out as two arguments naming one parameter.
   * Requirements minted against an already-concrete type carry no slot of their
   * own and fall back to the type, which is what the non-ABI readers of
   * `#publicRequirements` want.
   *
   * That the unpruned read comes **first** is also the guard that keeps #649
   * out of this slot name. `#display` names surviving variables, and two
   * distinct survivors then render alike — which is precisely the merge the
   * paragraph above calls a clean compile that read `.show` off `undefined`.
   * The short-circuit is what a slot-carrying requirement takes, so the display
   * fallback is left the requirements minted against a type, whose variables
   * are the callee's declared ones; instrumenting the fallback across the suite
   * found no arrival carrying an unsolved variable at all. Pruning first, or
   * dropping the `Variable` arm, would put one there — and the report the merge
   * produces is silence.
   */
  #evidenceSlot(requirement: Requirement): string {
    if (requirement.type.kind === "Variable") return `v${requirement.type.id}`;
    return this.#display(this.#prune(requirement.type));
  }

  /**
   * Functions §7.4's identity suffix: the evidence one reference inside the
   * monomorphic knot supplies — the member's **own** dictionary parameters,
   * unchanged, in the order its parameter list has.
   *
   * Read off the finished scheme, and off the very producer whose reader mints
   * those parameters: `#publicScheme`'s constraints are what `dictionaryEntries`
   * turns into the definition's suffix, and the sort here is that reader's, key
   * for key (FFI Part 9 §6.2's type-variable ordinal, then constraint name). So
   * arity and order are not two agreements to keep but one — an SCC-internal
   * reference is an ordinary call site whose instantiation is the identity, and
   * the identity of a substitution is the substitution itself.
   *
   * Nothing is selected here. Every constraint lands on a quantified variable,
   * which is a `Dictionary` node naming the enclosing definition's own
   * parameter — the same evidence-in-scope shape a non-recursive sibling call
   * takes (Constraints §6.1), and in value position the same eta-expansion.
   */
  #knotEvidence(symbol: Resolved.SymbolId): readonly Typed.Constraint[] {
    const entries: { readonly ordinal: number; readonly constraint: Typed.Constraint }[] = [];
    for (const constraint of this.#publicScheme(this.#scheme(symbol)).constraints) {
      if (constraint.type.kind !== "Variable") continue;
      entries.push({ ordinal: Number(constraint.type.id), constraint });
    }
    entries.sort((left, right) =>
      left.ordinal - right.ordinal ||
      left.constraint.name.localeCompare(right.constraint.name)
    );
    return entries.map(({ constraint }) => constraint);
  }

  #publicRequirements(requirements: readonly Requirement[]): readonly Typed.Constraint[] {
    const unique = new Map<string, Typed.Constraint>();
    for (const requirement of requirements) {
      const constraint = this.#publicRequirement(requirement);
      unique.set(`${constraint.identity}:${this.#evidenceSlot(requirement)}`, constraint);
    }
    return [...unique.values()];
  }

  /**
   * An instance's base-constraint obligations, each carrying the §6.2 slot the
   * emitted dictionary writes it under.
   *
   * Positional against the declaration's base list, which is what
   * `#instanceBaseRequirements` walked to raise these requirements in the first
   * place — the two lists have one origin, and pairing them by index is what
   * makes the slot the *declaration's* rather than a property of whichever word
   * the requirement carries.
   *
   * Deliberately **not** through `#publicRequirements`: its dedup key is
   * (identity, evidence slot), which silently collapses two entries of one base
   * list onto one property and loses the positional alignment the pairing
   * needs. §6.2 refuses that list outright now — `#checkBaseConstraintGraph`
   * reports it — so the only thing dedup could still merge is a program already
   * carrying a diagnostic, and one property per written entry is the honest
   * rendering of it.
   */
  #honorBaseConstraints(
    item: Resolved.HonorItem,
  ): readonly Typed.HonorBaseConstraint[] {
    const slots = this.#baseConstraintSlots(item.constraintIdentity);
    return (this.#instanceBaseConstraints.get(item) ?? []).flatMap(
      (requirement, index) => {
        const base = slots[index];
        return base === undefined
          ? []
          : [{ slot: base.slot, constraint: this.#publicRequirement(requirement) }];
      },
    );
  }

  #publicScheme(scheme: Scheme): Typed.Scheme {
    const variables = scheme.variables
      .map((variable) => this.#prune(variable))
      .filter((type): type is Variable => type.kind === "Variable");
    const constraints = new Map<string, Typed.Constraint>();
    for (const variable of variables) {
      for (const requirement of this.#keptRequirements(variable)) {
        const constraint = this.#publicRequirement(requirement);
        constraints.set(`${constraint.identity}:${variable.id}`, constraint);
      }
    }
    return {
      variables: variables.map(({ id }) => Typed.typeVariableId(id)),
      constraints: [...constraints.values()],
      type: this.#publicType(scheme.type),
      // A constraint member's scheme says so, so an importer can read it back
      // (Modules §6.5): without it, `describe` arrives as a function that
      // happens to be constrained and its implied types never project.
      ...(scheme.constraint === undefined ||
          scheme.constraintIdentity === undefined ||
          scheme.constraintSubject === undefined
        ? {}
        : {
            constraint: {
              name: scheme.constraint,
              identity: scheme.constraintIdentity,
              subject: Typed.typeVariableId(scheme.constraintSubject.id),
              impliedTypes: [...(scheme.impliedTypes ?? new Map())].map(
                ([name, variable]) => ({
                  name,
                  variable: Typed.typeVariableId(variable.id),
                }),
              ),
            },
          }),
    };
  }

  /**
   * An `exception` declaration in its typed form — split out of
   * `#materializeItem` because it runs over two sets: this module's own items,
   * and `visibleExceptions`, the prelude's and the imports' (#469). The second
   * set is nothing special here: an exception payload is concrete by rule
   * (Exceptions §3), so a foreign slot annotation elaborates without a
   * substitution, and the constructor's scheme is the one `importedSchemes`
   * already seeded.
   */
  #materializeException(item: Resolved.ExceptionItem): Typed.ExceptionItem {
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
      owner: item.owner,
      span: item.span,
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
        exported: item.exported,
        name: item.name,
        identity: item.identity,
        subject: Typed.typeVariableId(subject.id),
        // Both currencies cross, as they already do on an honor header's binder
        // constraints: the word written here, and the declaration it denoted
        // here. A reader holding the name alone can only re-derive the identity
        // through its own scope, which is the miscompile §6.2 forbids.
        //
        // Published for completeness, not for a reader: the checker's own base
        // walk takes the pairing off the *Resolved* declaration, which is what
        // `visibleConstraints` carries across a module boundary. See
        // `Typed.DeclaredBaseConstraint` for why it is published anyway.
        baseConstraints: item.baseConstraints.map((name, index) => ({
          name,
          identity: item.baseConstraintIdentities[index]!,
        })),
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
      const declaration = this.#constraintsByIdentity.get(item.constraintIdentity);
      const supplied = new Set(item.members.map(({ name }) => name));
      // Only a declaration whose helper this module could name (see
      // `#reachableConstraintHelpers`) enters §6.5's fork at all. A prelude
      // declaration's defaults are the compiler's wired-in completion's
      // business, which is what they were before the declaration existed.
      const omittedDefaults =
        this.#reachableConstraintHelpers.has(item.constraintIdentity)
          ? (declaration?.members ?? []).filter((member) =>
              member.defaultValue !== undefined && !supplied.has(member.binding.name)
            )
          : [];
      // Constraints §6.5's fork. An **exported** constraint's defaults were
      // hoisted to one helper at home, so every inheriting instance — here or in
      // an importing module — fills the slot by reference to it. An unexported
      // one materializes a copy of the body into this dictionary exactly as
      // before, which is what keeps that emission byte-identical.
      //
      // The fork is not merely an optimization. A default body belonging to an
      // *imported* declaration was typed in another module, so its expressions
      // have no entry in this checker's tables and `#materializeLambda` cannot
      // reconstruct it at all.
      const hoisted = declaration?.exported === true;
      const inherited = hoisted
        ? []
        : omittedDefaults.map((member) => ({
            name: member.binding.name,
            value: this.#materializeLambda(member.defaultValue!),
            span: member.span,
          }));
      const inheritedDefaults = hoisted
        ? omittedDefaults.map((member) => ({
            name: member.binding.name,
            member: member.binding.symbol,
            arity: member.defaultValue!.parameters.length,
            span: member.span,
          }))
        : [];
      return {
        kind: "Honor",
        // Canonical for the same reason as the binders below: this name keys the
        // instance's own evidence seat, and an alias is the importer's word.
        constraint: this.#canonicalConstraintName(
          item.constraint,
          item.constraintIdentity,
        ),
        constraintIdentity: item.constraintIdentity,
        typeParameters: item.typeParameters.map((parameter) => ({
          name: parameter.name,
          variable: Typed.typeVariableId(typeParameters.get(parameter.name)?.id ?? -1),
          // Canonical, because these name the evidence *parameters* the instance
          // takes, and the requirements they must answer arrive under the
          // declaration's own spelling (see `#canonicalConstraintName`). The
          // identity travels beside it because that is what the parameter is
          // *found* by; a header can only spell what is in scope here, so this
          // module's resolution settles which declaration each word denotes.
          constraints: parameter.constraints.map((constraint) => {
            const identity = this.#constraintIdentity(constraint);
            return {
              name: this.#canonicalConstraintName(constraint, identity),
              identity,
            };
          }),
          span: parameter.span,
        })),
        subject: this.#publicType(this.#instanceSubjects.get(item) ?? ERROR),
        derived: item.derived,
        dictionary: item.dictionary,
        ...(item.exportedDictionary === undefined
          ? {}
          : { exportedDictionary: item.exportedDictionary }),
        memberSeats: item.memberSeats,
        baseConstraints: this.#honorBaseConstraints(item),
        components: this.#publicComponents(this.#instanceComponents.get(item) ?? []),
        impliedTypes: item.impliedTypes.map((impliedType) => ({
          name: impliedType.name,
          type: this.#publicType(
            this.#instanceImpliedTypes.get(item)?.get(impliedType.name) ?? ERROR,
          ),
          span: impliedType.span,
        })),
        members: [
          // Dropped whole for a refused instance (#651). Every other field of
          // this arm coalesces a missing table entry; the member walk cannot,
          // because `#materializeUnwidenedExpr` reads `#requirements` for a
          // literal, an interpolation and a `hash(…)` call without a fallback —
          // and a body the `Honor` arm refused before inference reached it has
          // no entries at all. Elaboration and both emitters still run over this
          // item — `compileProject` calls them whatever the diagnostics say —
          // and what they are handed is an instance with no members, which is a
          // shape they already handle: the measured emission is an empty
          // dictionary, no crash and no further diagnostic. It is safe because
          // an erroring project is never *executed*, not because it is never
          // emitted. See `#uninferredInstanceMembers`.
          ...(this.#uninferredInstanceMembers.has(item)
            ? []
            : item.members.map((member) => ({
                name: member.name,
                value: this.#materializeLambda(member.value),
                span: member.span,
              }))),
          ...inherited,
        ],
        // The declaration's subject, so emission can bind the dictionary under
        // construction to it without looking the declaration up in a table of
        // its own — which was module-local, and so silently empty for an
        // imported or alias-qualified constraint.
        ...(declaration === undefined ||
            this.#constraintSubjects.get(declaration) === undefined
          ? {}
          : {
              constraintSubject: Typed.typeVariableId(
                this.#constraintSubjects.get(declaration)!.id,
              ),
            }),
        inheritedDefaults,
        span: item.span,
      };
    }
    if (item.kind === "ExprItem") {
      return { ...item, expression: this.#materializeExpr(item.expression) };
    }
    if (item.kind === "LetPattern") {
      // `parameter` is dropped rather than carried: it records which seat wrote
      // the `let` for one refutability report, and that report has already been
      // made. Nothing past the checker distinguishes the two.
      const { parameter, ...rest } = item;
      return {
        ...rest,
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
        type: this.#inPosition("alias", () => this.#publicType(this.#aliasTarget(item))),
        span: item.span,
      };
    }
    if (item.kind === "Exception") return this.#materializeException(item);
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

  /** One arm form, three seats (`match`, `try`'s `catch`, the match catch clause). */
  #materializeArms(arms: readonly Resolved.MatchArm[]): readonly Typed.MatchArm[] {
    return arms.map((arm) => ({
      pattern: this.#materializePattern(arm.pattern),
      ...(arm.guard === undefined ? {} : { guard: this.#materializeExpr(arm.guard) }),
      body: this.#materializeExpr(arm.body),
      span: arm.span,
    }));
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
        const knotTarget = this.#knotReferences.get(expression);
        const requirements = this.#calleeNames.has(expression)
          ? []
          : knotTarget !== undefined
            ? this.#knotEvidence(knotTarget)
            : this.#evidenceRequirements(this.#nameRequirements.get(expression) ?? []);
        return requirements.length === 0
          ? { ...expression, type }
          : { ...expression, type, requirements };
      }
      case "CollectionOperation":
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
      case "Ascription":
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
          arms: this.#materializeArms(expression.arms),
          type,
          span: expression.span,
        };
      case "Match":
        const union = this.#matchUnions.get(expression);
        return {
          kind: "Match",
          scrutinee: this.#materializeExpr(expression.scrutinee),
          arms: this.#materializeArms(expression.arms),
          ...(expression.catchArms === undefined
            ? {}
            : { catchArms: this.#materializeArms(expression.catchArms) }),
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
              symbol: dotCall.symbol,
              text: this.#operationSpellings.get(dotCall.symbol) ?? dotCall.name,
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
            requirements: this.#evidenceRequirements(dotCall.requirements),
            type,
            span: expression.span,
          };
        }
        // The callee's own knot reference, where there is one: the call owns the
        // evidence, and inside the knot that evidence is §7.4's identity suffix.
        const knotCallee = expression.callee.kind === "Name"
          ? this.#knotReferences.get(expression.callee)
          : undefined;
        return {
          ...expression,
          type,
          callee: this.#materializeExpr(expression.callee),
          arguments: expression.arguments.map((argument) => this.#materializeExpr(argument)),
          requirements: knotCallee === undefined
            ? this.#evidenceRequirements(this.#callRequirements.get(expression) ?? [])
            : this.#knotEvidence(knotCallee),
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
          ? {
              name: constraint,
              identity: this.#constraintIdentity(constraint),
              type: { kind: "Error" },
              span: expression.span,
            }
          : this.#publicRequirement(requirement),
      arguments: arguments_.map((argument) => this.#materializeExpr(argument)),
      type: this.#publicType(this.#typeOf(expression)),
      span: expression.span,
    };
  }

  /**
   * One type as a diagnostic reads it.
   *
   * The entry point is separate from the recursion because the arrow numbering
   * (#364) is a property of the **whole** displayed type: which colours are
   * numbered, and in what order, cannot be known part-way down. One `#display`
   * call is one displayed type expression, so a two-type report numbers each
   * side on its own.
   *
   * Undecorated arrows spell what the grammar can spell: **one** distinct
   * effect variable, which a written signature links into one colour (§2.2).
   * Only a face with more than one is numbered, because only that is
   * inexpressible. #405 dropped the second condition this used to carry — a
   * lone variable needed an *inlet* occurrence, or the else-constant rule would
   * read the undecorated spelling back as the impure constant — along with the
   * rule itself (§10, and Effects §11's note).
   *
   * Naming surviving variables is the other whole-type property, and for the
   * same reason: which names are free cannot be known part-way down. No
   * diagnostic displays a numbered inference variable (Constraints §8, #649),
   * so the naming happens here, on entry, at the one point every report reads a
   * type through — which is what makes `#render`'s `?N` fallback unreachable.
   * Naming only: it is a label, and `#display` is called mid-inference, where a
   * display that *settled* would be a display that mutates the program's
   * meaning. A seat that can honestly settle first does so before reporting
   * (Numeric Literals §6's own settle-then-name sequence).
   */
  #display(type: Mono): string {
    this.#nameSurvivingVariables(type);
    const colours = this.#effectVariables(type);
    return this.#render(
      type,
      colours.length <= 1 ? new Map() : new Map(colours.map((id, index) => [id, index + 1])),
    );
  }

  #render(type: Mono, numbering: ReadonlyMap<number, number>): string {
    const actual = this.#prune(type);
    if (actual.kind === "Error") return "<error>";
    if (actual.kind === "Constructor") return actual.name;
    // A declared variable has a name the user wrote; `?3` in its place is
    // unreadable, and worse inside a diagnostic the Rewrite Rule makes
    // mandatory. Since #649 the third arm is unreachable from any report:
    // `#display` names every survivor on entry, so a value-position variable
    // arriving here already has one of the first two. It stays as a **guard,
    // not a no-op** — an unnamed variable would otherwise render as `undefined`
    // in a mandatory fixit, and the one variable `#display` deliberately leaves
    // unnamed, an effect colour, prints through `#arrow` rather than here only
    // as long as effects stay out of value position. Whoever finds it redundant
    // should make the law hold without it, not delete it.
    if (actual.kind === "Variable") {
      return actual.rigidName ?? actual.displayName ?? `?${actual.id}`;
    }
    if (actual.kind === "Tuple") {
      // The arity-0 tuple displays as `Unit`, never `()` — diagnostics and the
      // pretty-printer say the type's one name (Products §2.7, #159).
      if (actual.elements.length === 0) return "Unit";
      return `(${actual.elements.map((element) => this.#render(element, numbering)).join(", ")})`;
    }
    if (actual.kind === "Union") {
      return actual.arguments.length === 0
        ? actual.name
        : `${actual.name}(${
          actual.arguments.map((argument) => this.#render(argument, numbering)).join(", ")
        })`;
    }
    if (actual.kind === "NominalRecord") {
      return actual.arguments.length === 0
        ? actual.name
        : `${actual.name}(${
          actual.arguments.map((argument) => this.#render(argument, numbering)).join(", ")
        })`;
    }
    if (actual.kind === "ExternType") return actual.name;
    if (actual.kind === "Range") return "Range";
    if (actual.kind === "Vector") return `Vector(${this.#render(actual.element, numbering)})`;
    if (actual.kind === "Set") return `Set(${this.#render(actual.element, numbering)})`;
    if (actual.kind === "Array") return `Array(${this.#render(actual.element, numbering)})`;
    if (actual.kind === "JsSet") return `JsSet(${this.#render(actual.element, numbering)})`;
    if (actual.kind === "Node") return `Node(${this.#render(actual.element, numbering)})`;
    if (actual.kind === "Nullable") return `Nullable(${this.#render(actual.value, numbering)})`;
    if (actual.kind === "Map" || actual.kind === "JsMap") {
      return `${actual.kind}(${this.#render(actual.key, numbering)}, ${
        this.#render(actual.value, numbering)
      })`;
    }
    if (actual.kind === "Record") {
      const fields = [...actual.fields].map(([name, field]) =>
        `${name}: ${this.#render(field, numbering)}`
      );
      if (actual.tail !== undefined) fields.push("...");
      return `{${fields.join(", ")}}`;
    }
    if (actual.kind === "Effect") return actual.impure ? "impure" : "pure";
    return (
      `(${actual.parameters.map((parameter) => this.#render(parameter, numbering)).join(", ")})` +
      ` ${this.#arrow(actual, numbering)} ${this.#render(actual.result, numbering)}`
    );
  }

  /**
   * Every effect variable one displayed type reaches, in the order the rendered
   * text first reaches it (#364).
   *
   * The walk follows the text, not the tree: a function prints its domain, then
   * its own arrow, then its result, so the effect slot is visited between the
   * parameters and the result.
   */
  #effectVariables(type: Mono, found = new Set<number>()): readonly number[] {
    const actual = this.#prune(type);
    if (actual.kind === "Function") {
      for (const parameter of actual.parameters) this.#effectVariables(parameter, found);
      if (actual.effect !== undefined) {
        const effect = this.#prune(actual.effect);
        if (effect.kind === "Variable") found.add(effect.id);
      }
      this.#effectVariables(actual.result, found);
    }
    if (actual.kind === "Tuple") {
      for (const element of actual.elements) this.#effectVariables(element, found);
    }
    if (actual.kind === "Record") {
      for (const field of actual.fields.values()) this.#effectVariables(field, found);
    }
    if (actual.kind === "Union" || actual.kind === "NominalRecord") {
      for (const argument of actual.arguments) this.#effectVariables(argument, found);
    }
    if (
      actual.kind === "Vector" || actual.kind === "Set" || actual.kind === "Array" ||
      actual.kind === "JsSet" || actual.kind === "Node"
    ) {
      this.#effectVariables(actual.element, found);
    }
    if (actual.kind === "Nullable") this.#effectVariables(actual.value, found);
    if (actual.kind === "Map" || actual.kind === "JsMap") {
      this.#effectVariables(actual.key, found);
      this.#effectVariables(actual.value, found);
    }
    return [...found];
  }

  /**
   * How a function type's arrow prints (#355, respelled #405). A pure arrow is
   * `->`, the constant is `->!`, and a variable colour is `->?` — carrying its
   * index (#364) only where the face holds more than one colour, which is the
   * one thing the written grammar cannot spell apart.
   */
  #arrow(type: FunctionMono, numbering: ReadonlyMap<number, number>): string {
    if (type.effect === undefined) return PURE_ARROW;
    const effect = this.#prune(type.effect);
    if (effect.kind === "Effect") return effect.impure ? IMPURE_ARROW : PURE_ARROW;
    return linkedArrow(effect.kind === "Variable" ? numbering.get(effect.id) : undefined);
  }
}

/** How a report names the thing being called. */
function calleeLabel(expression: Resolved.CallExpr): string {
  const callee = expression.callee;
  if (callee.kind === "Name") return `\`${callee.text}\``;
  if (callee.kind === "Access") return `\`.${callee.field.text}\``;
  return "this call";
}

/**
 * #385's not-callable sentence, for a callee whose type is known and is not a
 * function. The subject is named the way the mark reports name it
 * (`calleeLabel`) where there is a name to give; a compound callee has none, so
 * the sentence says "the callee" rather than pointing the reader at a phrase to
 * hunt for. No arrow appears anywhere in it — the report's subject is that
 * there is no function here, and a demanded arrow's colour is a claim about a
 * call that does not exist.
 */
function notCallableMessage(
  expression: Resolved.CallExpr,
  found: string,
  argumentCount: number,
): string {
  const callee = expression.callee;
  const subject = callee.kind === "Name" || callee.kind === "Access"
    ? `${calleeLabel(expression)} is not a function — it has type \`${found}\``
    : `this is not a function — the callee has type \`${found}\``;
  const supplied = argumentCount === 0
    ? "no arguments"
    : `${argumentCount} argument${argumentCount === 1 ? "" : "s"}`;
  return `${subject}, and this call supplies ${supplied}`;
}

/** The mark a colour requires, as source text. */
function markSpelling(mark: "bang" | "question" | undefined): string {
  return mark === "bang" ? "!" : mark === "question" ? "?" : "";
}

function markName(mark: "bang" | "question" | undefined): string {
  return mark === "bang" ? "`!`" : mark === "question" ? "`?`" : "no mark";
}

/**
 * Ruling 7's sentence, in all six directions. The mark is a function of the
 * solved colour, so the report says what the colour *is* rather than what it is
 * not — and the fix is one token either way.
 */
function markMessage(
  callee: string,
  written: "bang" | "question" | undefined,
  required: "bang" | "question" | undefined,
): string {
  const because = required === "bang"
    ? "this call runs effects"
    : required === "question"
      ? "this call is as effectful as the enclosing instantiation makes it"
      : "this call is pure";
  return `${because}, so ${callee} wants ${markName(required)}, not ${markName(written)}`;
}

function markFixMessage(required: "bang" | "question" | undefined): string {
  return required === undefined ? "remove the mark" : `mark the call ${markName(required)}`;
}

/**
 * The two-point lattice's one unification failure, in the two directions it has.
 * Said as a sentence about colour rather than as a type mismatch, because the
 * types on both sides are otherwise identical and a structural report would
 * print them the same way twice.
 *
 * `left` is the demand and `right` the supply, the convention `#unify`'s own
 * "expected … found …" fallback already keeps. The direction decides the
 * sentence, and it has to: the §4.3 report speaks of a written `->` *demand* in
 * every clause, and in the reverse direction — a pure function refused where a
 * `->?` data field, a result-only face, or a written `->!` demands the impure
 * constant — the demand wrote no `->`, so each clause misdescribes the program.
 */
function effectMismatchMessage(left: Mono, right: Mono): string {
  const impure = (side: Mono): boolean => side.kind === "Effect" && side.impure;
  if (left.kind === "Effect" && right.kind === "Effect" && impure(left)) {
    return "this position's arrow is the impure constant — its colour is fixed " +
      "where the type is declared, and this function's face is the pure `->`; " +
      "the demand cannot weaken — change the position's declared arrow, or " +
      "supply the effectful function the position promises";
  }
  return impure(left) || impure(right)
    ? "a `->` arrow promises purity, and this function performs effects — the " +
      "demand is written `->`, the function's face `->?` or `->!`"
    : "effect mismatch between these arrows";
}

/** Rewrites first-argument pipe insertion before either side is inferred. */
function rewritePipe(expression: Resolved.BinaryExpr): Resolved.CallExpr {
  // #355 ruling 1: a pipe stage is a call, so a mark the stage wore rides onto
  // the call the rewrite manufactures. A stage that supplied its own argument
  // list already carries its mark on that call and keeps it.
  const stageMark: { mark?: "bang" | "question"; markSpan?: Source.Span } =
    expression.mark === undefined
      ? {}
      : {
        mark: expression.mark,
        ...(expression.markSpan === undefined ? {} : { markSpan: expression.markSpan }),
      };
  return expression.right.kind === "Call"
    ? {
        kind: "Call",
        callee: expression.right.callee,
        arguments: [expression.left, ...expression.right.arguments],
        ...(expression.right.mark === undefined
          ? {}
          : {
            mark: expression.right.mark,
            ...(expression.right.markSpan === undefined
              ? {}
              : { markSpan: expression.right.markSpan }),
          }),
        span: expression.span,
      }
    : {
        kind: "Call",
        callee: expression.right,
        arguments: [expression.left],
        ...stageMark,
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

/** The head patterns of a matrix's first column, or-alternatives flattened. */
function coverageHeadPatterns(
  matrix: readonly (readonly Resolved.Pattern[])[],
): readonly Resolved.Pattern[] {
  return matrix.flatMap((row) =>
    row[0] === undefined ? [] : coverageAlternatives(row[0])
  );
}

/** A wildcard standing in where a pattern said nothing about a slot (§7.1). */
function wildcardAt(span: Source.Span): Resolved.Pattern {
  return { kind: "Wildcard", span };
}

/** `count` such stand-ins, for a head a wildcard row is specialized onto. */
function wildcardSlots(count: number, span: Source.Span): readonly Resolved.Pattern[] {
  return Array.from({ length: count }, () => wildcardAt(span));
}

/** `a`, `a` and `b`, `a`, `b` and `c` — the clause's own prose (§7.3). */
function englishList(items: readonly string[]): string {
  if (items.length <= 1) return items[0] ?? "";
  return `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`;
}

/** A witness's routes, with the head's own added where §7.3's tier 3 fired. */
function headRoutes(
  head: CoverageHead,
  routes: readonly RouteNeed[],
): readonly RouteNeed[] {
  return head.route === undefined ? routes : [head.route, ...routes];
}

/**
 * A module's own name, from its path: `/app/flags.hex` → `Flags`. The alias a
 * §7.3 module-import repair offers, and the name a prelude module's clause
 * states — both want the file's own name in constructor-alias case.
 *
 * Separators inside the file name (`my-flags`, `my_flags`) become word breaks,
 * so the derived alias is one identifier the compiler would accept.
 */
function moduleBaseName(path: string): string | undefined {
  const file = path.split("/").at(-1)?.replace(/\.hex$/u, "") ?? "";
  const name = file
    .split(/[^A-Za-z0-9]+/u)
    .filter((part) => part !== "")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join("");
  return name === "" ? undefined : name;
}

/**
 * The head key a constructor owns wherever it is written — the symbol, so a
 * qualified or renamed spelling groups with the plain one.
 */
function constructorHeadKey(symbol: Resolved.SymbolId): string {
  return `constructor:${symbol}`;
}

/**
 * A head nothing else can share, for a pattern whose column cannot decompose
 * it: a constructor that failed to type against its column, a rest that binds
 * a shape rather than a name. Such a pattern covers nothing and completes no
 * signature, which is the safe reading in both directions — it can neither
 * complete an exhaustiveness claim nor kill an arm below it. The key is the
 * span because a written pattern occupies its own, and two of them are never
 * the same test.
 */
function distinctHead(pattern: Resolved.Pattern): CoverageMatch {
  const { fileId, start, end } = pattern.span;
  return oneHead({
    key: `distinct:${fileId}:${start.offset}:${end.offset}`,
    slots: [],
    print: () => "_",
  }, []);
}

/** A pattern that tests exactly one head — every domain but the vector. */
function oneHead(
  head: CoverageHead,
  subPatterns: readonly Resolved.Pattern[],
): CoverageMatch {
  return { heads: [head], subPatterns: () => subPatterns };
}

/**
 * A vector pattern's sub-patterns at one length — Collections Part 3 §3.3's
 * specialization, and §3.1's "slots after the rest count from the end".
 *
 * The written slots sit at both ends: `rest.index` of them at the front, the
 * remainder flush against the back, and wildcards across the middle the rest
 * covers. At the pattern's own length (a fixed pattern, no rest) the two ends
 * meet and this is the elements in order.
 */
function vectorSlots(
  pattern: Resolved.VectorPattern,
  length: number,
): readonly Resolved.Pattern[] {
  const front = pattern.rest?.index ?? pattern.elements.length;
  const back = pattern.elements.length - front;
  return Array.from({ length }, (_, index) => {
    if (index < front) return pattern.elements[index] ?? wildcardAt(pattern.span);
    if (index >= length - back) {
      return pattern.elements[front + index - (length - back)] ??
        wildcardAt(pattern.span);
    }
    return wildcardAt(pattern.span);
  });
}

const EXPORTED_SIGNATURE =
  "an exported signature is complete (Modules §4.1.1); replace `_` with the intended type";

/**
 * One span per **written** hole inside one resolved annotation, outermost
 * first.
 *
 * §4.1's unit is the written `_`, and alias substitution copies one written
 * hole's node into every position the alias body mentions its parameter —
 * `type Pair(a) = (a, a)` reached as `Pair(_)` puts two nodes in the tree for
 * the one `_`. The copies share the id they were minted with, so collapsing on
 * it says the written hole once, which is what the fence has to say. The span
 * must not serve, though today it would coincide: a copy keeps the written
 * `_`'s span only because `withTypeSpan` exempts holes, and identity cannot
 * rest on that choice (see `HoleTypeAnnotation.id`).
 */
function typeAnnotationHoles(
  annotation: Resolved.TypeAnnotation,
): readonly Source.Span[] {
  const written = new Map<number, Source.Span>();
  for (const hole of typeAnnotationHoleNodes(annotation)) {
    if (!written.has(hole.id)) written.set(hole.id, hole.span);
  }
  return [...written.values()];
}

/** Every hole node inside one resolved annotation, copies included. */
function typeAnnotationHoleNodes(
  annotation: Resolved.TypeAnnotation,
): readonly Resolved.HoleTypeAnnotation[] {
  switch (annotation.kind) {
    case "Hole":
      return [annotation];
    case "Function":
      return [
        ...annotation.parameters.flatMap(typeAnnotationHoleNodes),
        ...typeAnnotationHoleNodes(annotation.result),
      ];
    case "Vector":
    case "Set":
    case "Array":
    case "JsSet":
    case "Node":
      return typeAnnotationHoleNodes(annotation.element);
    case "Nullable":
      return typeAnnotationHoleNodes(annotation.value);
    case "Map":
    case "JsMap":
      return [
        ...typeAnnotationHoleNodes(annotation.key),
        ...typeAnnotationHoleNodes(annotation.value),
      ];
    case "Tuple":
      return annotation.elements.flatMap(typeAnnotationHoleNodes);
    case "Record":
      return annotation.fields.flatMap((field) => typeAnnotationHoleNodes(field.annotation));
    case "Union":
    case "RecordDeclaration":
      return annotation.arguments.flatMap(typeAnnotationHoleNodes);
    case "ExternType":
    case "Primitive":
    case "Range":
    case "TypeVariable":
    case "ImpliedType":
    case "ErrorType":
      return [];
  }
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
    case "JsSet":
    case "Node":
      return annotationHasTypeVariable(annotation.element);
    case "Nullable":
      return annotationHasTypeVariable(annotation.value);
    case "Map":
    case "JsMap":
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
    // A hole is not a type variable: it claims no generality (closure doc §2.3),
    // so it does not make a declaration generic. Every surface that reads this
    // predicate is a total-contract position, where `#rejectTypeHoles` has
    // already refused the hole outright with the diagnostic that names its
    // rewrite — so answering `true` here would only add a second, worse report.
    case "Hole":
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
    case "JsSet":
      return annotationMentionsNode(annotation.element);
    case "Nullable":
      return annotationMentionsNode(annotation.value);
    case "Map":
    case "JsMap":
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
    case "Hole":
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
    // The borrowed views nest like every other container: `JsMap(String,
    // Seq(Int))` is FFI Part 1 §5.3's hard error at the declaration site, cited
    // by Part 10 §8, not extended by it.
    annotation.kind === "JsSet" ||
    annotation.kind === "Node"
  ) {
    return recurse(annotation.element);
  } else if (annotation.kind === "Nullable") {
    return recurse(annotation.value);
  } else if (annotation.kind === "Map" || annotation.kind === "JsMap") {
    return recurse(annotation.key) ?? recurse(annotation.value);
  } else if (annotation.kind === "Union" || annotation.kind === "RecordDeclaration") {
    for (const argument of annotation.arguments) {
      const found = recurse(argument);
      if (found !== undefined) return found;
    }
  }
  return undefined;
}

/**
 * Every pattern node inside `pattern`, itself included — the walk §7.2's dual
 * needs: a row is a shadower only if *nothing* in it failed to type.
 */
function resolvedPatternNodes(
  pattern: Resolved.Pattern,
): readonly Resolved.Pattern[] {
  switch (pattern.kind) {
    case "Binding":
    case "Wildcard":
    case "Unit":
    case "Integer":
    case "String":
      return [pattern];
    case "As":
      return [pattern, ...resolvedPatternNodes(pattern.pattern)];
    case "Or":
      return [pattern, ...pattern.alternatives.flatMap(resolvedPatternNodes)];
    case "Tuple":
      return [pattern, ...pattern.elements.flatMap(resolvedPatternNodes)];
    case "Vector":
      return [
        pattern,
        ...pattern.elements.flatMap(resolvedPatternNodes),
        ...(pattern.rest?.pattern === undefined
          ? []
          : resolvedPatternNodes(pattern.rest.pattern)),
      ];
    case "Record":
      return [
        pattern,
        ...pattern.fields.flatMap((field) => resolvedPatternNodes(field.pattern)),
      ];
    case "Constructor":
      return [pattern, ...pattern.arguments.flatMap(resolvedPatternNodes)];
  }
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

function isConstraintName(name: string): name is Typed.ConstraintName {
  return PRE_REGISTERED_CONSTRAINTS.includes(name);
}

/**
 * The declaration with the given identity in a nominal listing.
 *
 * A plain scan rather than a map because the one caller reaches for it after
 * the module's own indexed views have already missed, on a path that is about
 * to build a diagnostic and then stop.
 */
function find<T extends { readonly id: Id }, Id>(
  declarations: Iterable<T>,
  id: Id,
): T | undefined {
  for (const declaration of declarations) {
    if (declaration.id === id) return declaration;
  }
  return undefined;
}

/**
 * Products §3.2's missing-field sentence — "name the known fields" — and the
 * one shape it is not allowed to take (Modules §4.2, #587).
 *
 * "An empty field enumeration is malformed output, never a compiler sentence",
 * and the way to keep it out is not a check before the join but a renderer with
 * no path to it: the enumerating clause is written **once**, inside the arm
 * that has already destructured a first name out of the list, so a caller
 * holding nothing cannot reach it. The empty arm is a sentence of its own,
 * because a record with no fields at all is a legal declaration (`record Empty
 * = {}`) and its reader still deserves a reason.
 *
 * `subject` is the nominal's name, or absent for a structural row — the two
 * callers are the two arms of `Access`, and they differ only in whether the
 * record has a name to be called by.
 */
function missingFieldMessage(
  subject: string | undefined,
  known: readonly string[],
  field: string,
): string {
  const [first, ...rest] = known;
  if (first === undefined) {
    return subject === undefined
      ? `the empty record has no field \`${field}\``
      : `\`${subject}\` has no fields, so it has no field \`${field}\``;
  }
  const enumeration = [first, ...rest].map((name) => `\`${name}\``).join(", ");
  return subject === undefined
    ? `record has fields ${enumeration}, not \`${field}\``
    : `\`${subject}\` has fields ${enumeration}, not \`${field}\``;
}

function inferredTypeVariableName(index: number): string {
  return index < 26 ? String.fromCharCode("a".charCodeAt(0) + index) : `t${index + 1}`;
}

/**
 * The knot member a head owner sits inside, or the head's own site — the test
 * that decides whether §10's rigid-vs-rigid refusal is this component's (#700).
 *
 * A block head is inside the knot when *any* member it scopes over is: the head
 * is one declaration over several members, and a component that reaches one of
 * them reaches the variable.
 */
/**
 * Statements §9.3's row for the function-typed `var` (#700) — one wording for
 * both arms, the declaration's and the pinning use's.
 *
 * The rewrite is the ruling's own: model changing behavior as data, which is
 * what a `var` is for.
 */
function functionTypedVarMessage(name: string): string {
  return `\`${name}\` is a \`var\`, and a \`var\` cannot hold a function — vars ` +
    "accumulate data; model changing behavior as a union and `match` on it";
}

function knotHeadSite(knot: Knot, owner: HeadOwner): HeadSite | undefined {
  if (owner.kind === "member") {
    const member = knot.members.find(({ symbol }) => symbol === owner.symbol);
    return member === undefined ? undefined : { kind: "member", member };
  }
  return knot.members.some(({ symbol }) => owner.members.includes(symbol))
    ? { kind: "block", span: owner.span }
    : undefined;
}

/**
 * Functions §10's SCC hint for two declared heads the knot links.
 *
 * Each side is qualified by its **declaring site**, because a block whose
 * members spell the same variable name is the shape that produces this refusal
 * and an unqualified pair reads as "`a` and `a`". A member is named; *(#700)* a
 * block head binds no name, so it is quoted as the head and located by the
 * diagnostic's label.
 *
 * The advice the generic message carries — one name in both annotations — is
 * what the refused program already writes, so it is not offered here. §7.4's
 * spellings are, the block first: one head on the block, annotation-free members
 * inference links, or the non-recursive wrapper. Which of the three are legal is
 * what the export count decides (Modules §4.1.1 requires a complete signature on
 * an exported function):
 *
 * - **A block head is one side**: the head is already the sharing route, so the
 *   repair is to write *its* variable in both members — "one head on the block
 *   both members write". Dropping annotations is not offered against a head that
 *   is not the collision's fault, and the wrapper remains.
 * - **Neither member exports**: drop the members' own variable annotations and
 *   let inference link the knot, or take the head, or the wrapper.
 * - **One exports**: the exporting member cannot drop annotations (§4.1.1), so
 *   the sibling drops its own — or the head, or the wrapper.
 * - **Both export**: neither may drop, so the head or the wrapper.
 */
function knotHeadCollisionMessage(
  leftName: string,
  rightName: string,
  left: HeadSite,
  right: HeadSite,
): string {
  const qualify = (name: string, site: HeadSite): string =>
    site.kind === "block"
      ? `\`${name}\` declared on the \`fun\` block head`
      : `\`${name}\` declared on \`${site.member.name}\``;
  const heads = `${qualify(leftName, left)} and ${qualify(rightName, right)} are distinct ` +
    "declared type variables, but members of a recursive knot are checked together at " +
    "not-yet-general types";
  const block = "declare one head on the `fun` block that both members write";
  const wrapper = "move the contract to a non-recursive wrapper";
  if (left.kind === "block" || right.kind === "block") {
    return `${heads}; ${block}, or ${wrapper}`;
  }
  const leftMember = left.member;
  const rightMember = right.member;
  if (leftMember.exported && rightMember.exported) {
    return `${heads}; ${block}, or ${wrapper} over an unexported knot`;
  }
  if (!leftMember.exported && !rightMember.exported) {
    return `${heads}; ${block}, drop the members' own variable annotations and let ` +
      `inference link the knot, or ${wrapper}`;
  }
  const exporting = leftMember.exported ? leftMember : rightMember;
  const plain = leftMember.exported ? rightMember : leftMember;
  return `${heads}; ${block}, or drop \`${plain.name}\`'s own variable annotations and let ` +
    `it reach \`${exporting.name}\` generically, or ${wrapper}`;
}

/**
 * Keeps the technical projection vocabulary out of source-facing diagnostics.
 *
 * The **name** states the refusal, because that is the word the reader wrote;
 * the **identity** chooses the repair, because `Seq` is the way around one
 * particular declaration and not around a word (#727). The pair used to be one
 * argument, so `import { Iterable as I }` plus `<c: I>` lost the repair clause
 * from the message that carried it while the very next diagnostic — raised from
 * the loop head, where the compiler spells the constraint itself — still
 * printed it. The gate beside every call site (`#bearsProjection`) already asks
 * by identity, and this now asks the same question the same way.
 */
function impliedTypeBinderMessage(constraint: string, identity: string): string {
  const reason = `\`${constraint}\` declares an implied type and cannot constrain a type variable in v1`;
  return identity === preRegisteredConstraintIdentity("Iterable")
    ? `${reason}; take a \`Seq(a)\` parameter instead`
    : reason;
}
