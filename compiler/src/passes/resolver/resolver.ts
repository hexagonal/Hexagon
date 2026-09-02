/**
 * The first resolver assigns stable identities to local bindings and replaces
 * textual references with those identities. It deliberately covers only the
 * binding forms admitted by the current parser: sequential lets and vars,
 * directly recursive functions, patterns, lambda parameters, and owner-relative
 * implied type names.
 */

import * as Diagnostics from "../../support/diagnostics.js";
import {
  declaredConstraintIdentity,
  isPreRegisteredConstraint,
  NON_REDECLARABLE_CONSTRAINTS,
  PRE_REGISTERED_CONSTRAINT_MEMBERS,
  preRegisteredConstraintIdentity,
  STRUCTURAL_CONSTRAINTS,
} from "../../constraints.js";
import {
  INTRINSIC_INVENTORY,
  INTRINSIC_SPECIFIER,
  isIntrinsicScheme,
  nearestIntrinsicKey,
} from "../../intrinsics.js";
import { relativeSpecifier } from "../../support/paths.js";
import type * as Source from "../../support/source.js";
import * as Parsed from "../../syntax/parsed/index.js";
import * as Resolved from "../../syntax/resolved/index.js";

export interface ModuleInterface {
  readonly module: Resolved.Module;
  readonly terms: ReadonlyMap<string, Resolved.Symbol>;
  readonly unions: ReadonlyMap<string, Resolved.Union>;
  readonly records: ReadonlyMap<string, Resolved.RecordDeclaration>;
  /**
   * Exceptions this module exports, by declared name. Their *names* are in
   * `terms` like any other constructor — this is the **declaration** beside it,
   * which an importer's checker needs in order to know the symbol is an
   * exception constructor at all and to read its payload slots
   * (`Resolved.Module.visibleExceptions`, #469).
   */
  readonly exceptions: ReadonlyMap<string, Resolved.ExceptionItem>;
  readonly aliases: ReadonlyMap<string, Resolved.TypeAliasItem>;
  readonly externTypes: ReadonlyMap<string, Resolved.ExternTypeDeclaration>;
  readonly instances: readonly InstanceInterface[];
  /**
   * Constraints this module exports, by declared name (Modules §4.1) — the ones
   * an importer may **name**, in a binder or through a module alias.
   */
  readonly constraints: ReadonlyMap<string, Resolved.ConstraintItem>;
  /**
   * The members of those constraints, by declared name (Modules §3.1: they
   * arrive with the constraint).
   *
   * Deliberately not folded into `terms`. A member is an ordinary module-scope
   * term once it is in scope, but it is not an independently importable export:
   * `import { describe }` naming only a member is refused (§3.1's "cannot be
   * imported severally", §12.4). Qualified access through a module alias reads
   * this map after `terms`, which is what makes `Geo.describe(x)` an ordinary
   * term reference (§3.3).
   */
  readonly constraintMembers: ReadonlyMap<string, Resolved.Symbol>;
  /**
   * Every constraint declaration reachable from this module, **exported or
   * not**, deduplicated by identity — metadata for the checker, never scope.
   *
   * Private ones are here on purpose, and they are the point of the channel: a
   * base constraint crosses because it *is* part of the declaration (§6.5), so
   * `export constraint Big<a: Small>` over a private `Small` puts `Small` in
   * every importer's base graph while leaving it unnameable everywhere. See
   * `Resolved.Module.visibleConstraints` for why one hop is not enough.
   */
  readonly visibleConstraints: readonly Resolved.ConstraintItem[];
  /**
   * The terms above bound by a **`widens` declaration** — a companion's own
   * wider face of a constraint member it honors at its own type (Constraints
   * §4.7, Modules §5.3's generalisation law; #541, form #546).
   *
   * Such a binding inherits the member's visibility rule: it is *qualifiable,
   * not a bare export*. It stays in `terms`, because `Float.pow` and the dot
   * call are exactly the spellings it owns; what it never does is enter a
   * consumer's bare scope or count as an exporter for §5.5's collision
   * arithmetic, so bare `pow` keeps its one exporter (`Pow.hex`'s member)
   * however many companions widen their `pow`.
   *
   * Read off the **declaration form**, never off a spelling coincidence: since
   * #546 the form declares exactly the properties the binding has, so no
   * signature question and no name collision decides visibility.
   */
  readonly widensBindings: ReadonlySet<string>;
}

export interface InstanceInterface {
  readonly identity: string;
  readonly constraint: string;
  /**
   * The identity of the constraint declaration this instance answers
   * (`spec/constraints.md` §5.1.1). Minted by the declaring module and passed
   * through untouched, like `identity` — an importer that re-derived it from
   * `constraint` would be back to keying coherence on a spelling.
   */
  readonly constraintIdentity: string;
  readonly typeParameters: readonly Resolved.TypeParameter[];
  readonly subject: Resolved.TypeAnnotation;
  readonly impliedTypes: readonly Resolved.HonorImpliedType[];
  readonly dictionary: string;
  /**
   * Whether the declaring module derived this instance — see
   * `Resolved.InstanceImport.derived`, which this becomes on the far side. The
   * declaring module's word, so it passes through a transit re-export untouched
   * exactly as the two fields below do.
   */
  readonly derived: boolean;
  /**
   * The instance's member seats under this interface's spellings (#444), and
   * the path of the module that declared it — see `Resolved.InstanceImport`,
   * whose two fields these become on the far side. Both pass through a transit
   * re-export untouched, because both are the declaring module's word.
   */
  readonly memberSeats: readonly Resolved.MemberSeat[];
  readonly declaringPath?: string;
  readonly span: Source.Span;
}

/**
 * Which of Statements §5's two binder classes a pattern's binders take. The
 * class comes from the binder's *position*, never from the pattern's grammar:
 * the same `{name}` is sequential on a `let` LHS and a head binder in a lambda
 * head or a match arm.
 *
 * - `"sequential"` — a `let` pattern. Scopes over the open-ended rest of its
 *   block, so it may not reuse any name in scope (§5.1 rule 1).
 * - `"head"` — a match arm, a catch arm, or a `for..in` binder. Governs a region
 *   the construct delimits and owns a scope of its own, so it may shadow
 *   anything (rule 2) with nothing to collide against.
 * - `"parameter"` — a pattern parameter. A head binder as well, but one that
 *   shares the lambda's scope with the parameters beside it, so the one name it
 *   may not take is a sibling parameter's (rule 3).
 */
type BinderClass = "sequential" | "head" | "parameter";

/**
 * A block's term declarations that the walk has not reached yet, plus the `fun`
 * symbols the block declares. Both exist for one diagnostic: a name that is not
 * in scope but *is* declared further down reads top-down (Functions §7.2), and
 * when both sides are `fun`s of the same block the split-group rule (§7.3) is
 * the actual repair.
 */
interface BlockDeclarations {
  readonly later: Map<string, LaterDeclaration>;
  readonly funSymbols: Set<Resolved.SymbolId>;
  /**
   * The prelude names this scope's own declarations take over — Modules §5.4's
   * **reservation**. Where the block declares a name the prelude binds, the
   * prelude's binding is invisible for the whole block, from its first item on,
   * and every reference resolves as if the prelude did not bind the name. That
   * is what makes a use above the binder read like a use above any other
   * declaration: `#findLaterDeclaration` answers it, not the prelude.
   *
   * Fixed when the frame is built, never narrowed as the walk passes the
   * declaration — "the whole block" is the point, and after the binder the
   * binding itself is what the lookup lands on anyway.
   */
  readonly reserved: Set<string>;
}

/**
 * `owner` is the declaring form for a name a type-namespace declaration binds —
 * what a diagnostic must tell the reader to move, since the constructor is not
 * itself movable.
 *
 * `move` overrides the whole noun phrase instead, for a binder whose movable
 * item is not "*something*'s declaration": an `import` binds its term names
 * without declaring them, so §7.2's repair there is "move **the import** above
 * this use" (Modules §3), in value and pattern position alike.
 */
interface LaterDeclaration {
  readonly name: Parsed.Name;
  readonly fun: boolean;
  readonly owner?: string;
  readonly move?: string;
}

/**
 * What one `import` item's **type-namespace** half bound, decided before any
 * item is walked (Modules §3). The item reads it rather than redeciding it, so
 * that a name a collision refused is refused in one place — and so that the term
 * half, which the item still owns, can tell which constraints it must bring
 * members for.
 */
interface ImportTypeBindings {
  /** What this line put in the constraint namespace; see `ConstraintImport`. */
  readonly constraints: readonly Resolved.ConstraintImport[];
  /** Whether the alias bound here — a duplicate spelling (§5.2) binds none. */
  readonly aliasBound: boolean;
}

/**
 * The **term**-namespace names a type-namespace declaration binds: a union's and
 * record's constructors, an exception's, a constraint's members. Functions §7.2
 * governs their references — value position, and equally the pattern position a
 * constructor reaches; the type names beside them are not here, because a
 * type-position mention is order-free.
 */
function termNamesBound(
  item: Parsed.Item,
): readonly { readonly name: Parsed.Name; readonly owner: string }[] {
  if (item.kind === "Union") {
    return item.constructors.map(({ name }) => ({ name, owner: "union" }));
  }
  if (item.kind === "RecordDeclaration") return [{ name: item.name, owner: "record" }];
  if (item.kind === "Exception") return [{ name: item.name, owner: "exception" }];
  if (item.kind === "ConstraintDeclaration") {
    return item.members.map(({ name }) => ({ name, owner: "constraint" }));
  }
  return [];
}

/** Sequential binders are `let`s; both head classes are pattern binders. */
function declaredKind(binderClass: BinderClass): Resolved.SymbolKind {
  return binderClass === "sequential" ? "let" : "pattern";
}

/**
 * An English list of **two or more** parts — `a and b`, `a, b, and c` — for a
 * diagnostic that must enumerate rather than pick. A caller with one part has
 * nothing to enumerate and does not reach here.
 *
 * The conjunction is the caller's, because one list reads two ways in one
 * message: the homes a name has are *all* of them, the rewrites offered are any
 * *one* of them.
 */
function conjoin(parts: readonly string[], conjunction: "and" | "or"): string {
  const last = parts.at(-1)!;
  const leading = parts.slice(0, -1);
  return leading.length === 1
    ? `${leading[0]} ${conjunction} ${last}`
    : `${leading.join(", ")}, ${conjunction} ${last}`;
}

/**
 * One route to a prelude name that is not in the bare set (Modules §5.5, #742):
 * a module that exports it, and what a rewrite of a bare reference to it looks
 * like when spelled through that module.
 *
 * A name may have several — the collection vocabulary is shared by design
 * (`empty` has four homes) — and they are recorded in prelude order, which is
 * the order §10 says the refusal enumerates them in.
 */
interface PreludeRoute {
  /** The exporting module's basename, which is the alias its qualified spelling uses. */
  readonly home: string;
  /**
   * Which of §5.5's channels this route belongs to. A constructor names only its
   * qualified spelling; a member names the declaring module; a function names
   * every exporter.
   */
  readonly channel: "function" | "member" | "constructor";
  /**
   * Whether the first parameter's type is the one the dot dispatches on — the
   * home module's own type for a function (Method Syntax §4.2), the constraint's
   * subject for a member (Method Syntax §7). The dot form is offered exactly
   * where this holds; `Num.fromNat(value)` has no receiver to write it with.
   *
   * Read off the **declaration**, which is where the fact lives; the message
   * then spells the form with the *call's* arguments, never the declaration's
   * parameter names (§5.5).
   */
  readonly dotCallable?: true;
  /**
   * The declared parameter count, where the export is a function.
   *
   * The dot form is offered only where the call's own arity matches it. A call
   * written at the wrong arity is a mistake this refusal is not reporting, and
   * `hash(a, b)` rendered as `(a).hash(b)` would answer it with a second one —
   * so the message drops to the non-call shape and names the routes without
   * pretending to rebuild the call.
   */
  readonly arity?: number;
  /**
   * Set on a member of a constraint whose instances at structural types are
   * **automatic** (`STRUCTURAL_CONSTRAINTS` — `Eq`, `Ord`, `Show`, `Hash`;
   * Constraints §4.5's structural bullet).
   *
   * Such an instance is not in Method Syntax §4.2's honored table, so the dot
   * does not fire at a structural receiver even though the constraint is
   * satisfied there: `[1, 2]` has `Hash`, and `([1, 2]).hash()` is still
   * refused. The refusal reads this to drop the dot form at a written vector
   * literal, where the two facts meet.
   *
   * Keyed off the **declaring constraint's identity**, never its spelling. What
   * that buys is narrow and worth stating exactly: it is about a *second prelude
   * constraint* declaring a same-spelled member — `Hash`'s `hash` is structural,
   * another prelude constraint's `hash` is not, and only the identity tells them
   * apart. A **user's** constraint is not the case: its member occludes the
   * prelude layer whole (§5.4), so no refusal is reached at all and no route of
   * the prelude's is consulted.
   *
   * No program distinguishes the two keyings *today*, and that is a property of
   * the inventory rather than of this code: every structural constraint is
   * pre-registered and non-redeclarable, so a structural member's spelling is
   * always declared by its own structural constraint, which is always seated —
   * and the dot is gated on *any* structural route, so marking a second one
   * changes no message. `prelude-bare-set.test.ts` pins that property, so a
   * structural constraint that is not pre-registered reddens a row rather than
   * silently widening this flag. The identity is what stays right when it does.
   */
  readonly structural?: true;
}

/**
 * The basename of the module a value of this annotation's type dispatches to,
 * or `undefined` where nothing does.
 *
 * Method Syntax §4.2 reads the receiver's type and looks for the operation in
 * that type's home module — its companion for a primitive (`Int.hex` for `Int`),
 * its declaring module for a nominal, and the compiler-owned collections'
 * own modules for `Vector`, `Map` and `Set`. That is the whole question a
 * refusal has to answer before it offers a dot form, and it is answerable here,
 * without types, because a prelude signature's first parameter is written out.
 *
 * Conservative by construction: a shape not listed answers `undefined`, and the
 * refusal falls back to naming the qualified spelling alone — a message that is
 * never wrong, only less helpful.
 */
function annotationCompanion(annotation: Resolved.TypeAnnotation): string | undefined {
  switch (annotation.kind) {
    case "Primitive":
      return annotation.name;
    case "Union":
    case "RecordDeclaration":
    case "ExternType":
      return annotation.name;
    case "Vector":
      return "Vector";
    case "Map":
      return "Map";
    case "Set":
      return "Set";
    case "Array":
      return "Array";
    case "JsValue":
      return "JsValue";
    default:
      return undefined;
  }
}

/**
 * A refused call's arguments as the program wrote them, with the first one also
 * rendered as a **dot-call receiver** (Modules §10, #742).
 *
 * The two differ, and have to: a qualified spelling takes each argument
 * unchanged inside its parentheses, while a dot form puts the first one in front
 * of a `.` where the grammar reads it as far as it can. `-7` written there
 * changes the program — `-7.div(2)` parses as `-(7.div(2))` and answers −3 where
 * `Integral.div(-7, 2)` answers −4 — so the two routes one message offers would
 * not be the same operation. The receiver carries whatever parentheses that
 * costs; the argument list never does.
 */
interface WrittenArguments {
  /** Each argument's source text, for the qualified spellings' argument lists. */
  readonly texts: readonly string[];
  /**
   * The first argument as a receiver, parenthesised where the dot would misread
   * it — or `undefined` where **no dot form exists to offer**: a structural
   * value has no companion module to dispatch to (Method Syntax §5), so a tuple,
   * `()`, or a record literal takes the qualified route alone.
   */
  readonly receiver: string | undefined;
  /**
   * Whether the receiver is a **written vector literal**. Paired with a route's
   * `structural`, it is the one shape where a dot-callable member still has no
   * dot: `hash([1, 2])` names the qualified route alone, while `length([1, 2])`
   * keeps `([1, 2]).length()` (Modules §5.5).
   */
  readonly vectorLiteral: boolean;
}

/**
 * Whether an expression can stand in front of a `.` **as written**, or has to be
 * parenthesised first.
 *
 * Three can because the dot cannot reach into their text: a plain name, a field
 * or module access (a dot chain already), and a call. Two more can because their
 * text is **already fully parenthesised** by the grammar that wrote it — a group
 * and an ascription — and a second pair would only double what is there. A tuple
 * and `()` are parenthesised too and are deliberately *not* here: they are not
 * dot receivers at all (`structuralReceiver` below), so the question never
 * reaches this predicate for them.
 *
 * Everything else is parenthesised, which is always legal (a parenthesised
 * receiver dispatches exactly as a bare one does — probed at every literal
 * class) and is only ever noise where it is unnecessary: the message may be
 * wordier than a human would write, never wrong. That asymmetry is the whole
 * reason the test is a small allowlist rather than a list of the shapes that
 * need help — a shape nobody thought of gets parentheses and stays correct.
 */
function dispatchesAsWritten(expression: Parsed.Expr): boolean {
  return expression.kind === "Name" || expression.kind === "Access" ||
    expression.kind === "Call" || expression.kind === "Group" ||
    expression.kind === "Ascription";
}

/**
 * Whether an expression is a **structural value written out** — a tuple, `()`,
 * or a record literal — and so has no dot form to be offered (Modules §5.5's
 * rider; Method Syntax §5).
 *
 * Dot dispatch reads the receiver's type and looks for the operation in that
 * type's home module. A structural type has none: there is no module addressable
 * under "tuple", and `(1, 2).hash()` cannot resolve however it is spelled. The
 * refusal names the qualified route alone rather than offering a form that
 * cannot work.
 *
 * Read through a group, so a writer's own parentheses do not hide the shape.
 * Read off the *written* expression and nothing else: a **name** of structural
 * type stays offered, because resolution has no types and a rule that guessed
 * would be wrong in the other direction — the qualified route beside it is
 * correct either way.
 */
function structuralReceiver(expression: Parsed.Expr): boolean {
  const inner = expression.kind === "Group" ? expression.expression : expression;
  return inner.kind === "Tuple" || inner.kind === "Unit" || inner.kind === "Record";
}

/**
 * Whether an expression is a **written vector literal** — the receiver half of
 * the structural-member narrowing (Modules §5.5).
 *
 * A `Vector` is not a structural *value* the way a tuple is: it has a companion
 * module, and `([1, 2]).length()` and `([1, 2]).toSeq()` both compile. What it
 * does not have is a place in Method Syntax §4.2's honored table for `Eq`, `Ord`
 * and `Hash`, whose instances at it are automatic (Constraints §4.5) — so those
 * members alone have no dot at a vector. The narrowing is therefore by *name*
 * rather than by receiver: it asks whether any route this name has is one of
 * those members, and drops the dot form for the whole message when one is.
 *
 * Read through a group for `structuralReceiver`'s reason, and off the *written*
 * expression only: a name bound to a vector keeps its dot form, since resolution
 * has no types to know it by.
 */
function vectorLiteralReceiver(expression: Parsed.Expr): boolean {
  const inner = expression.kind === "Group" ? expression.expression : expression;
  return inner.kind === "Vector";
}

/** `Home.name(…)` — one route's qualified spelling, carrying the call's arguments. */
function qualifiedSpelling(
  name: string,
  home: string,
  written: readonly string[] | undefined,
): string {
  return written === undefined
    ? `\`${home}.${name}\``
    : `\`${home}.${name}(${written.join(", ")})\``;
}

/**
 * Modules §10's refusal of a bare reference to a prelude name outside the bare
 * set — **one message shape across all three channels**, differing only in the
 * routes it lists (§5.5's last-but-one bullet).
 *
 * The routes are spelled **in the program's own words**: at a call, with the
 * call's own arguments, so `map(things, f)` draws `things.map(f)`,
 * `Seq.map(things, f)`, `Stream.map(things, f)`; at a reference that is not a
 * call, the qualified names alone. The message invents no identifier the program
 * does not contain — a rewrite naming an argument the reader cannot see is not a
 * rewrite, and the declared parameter names are the callee's words, not theirs.
 *
 * The dot comes first where the function is dot-callable, because it is the
 * everyday surface the design leans on; then **every** visible exporter's
 * qualified spelling, in prelude order, with no elision — a reader deciding
 * between `Seq` and `Stream` needs both spellings in front of them, and the one
 * the dot would have chosen is not knowable here.
 *
 * **No import route is ever named** (ruling 5). The accidental per-name opt-in is
 * not a designed door, and #750 holds the design of one.
 */
function refusedBarePreludeMessage(
  name: string,
  routes: readonly PreludeRoute[],
  written: WrittenArguments | undefined,
): string {
  const spellings: string[] = [];
  // The structural narrowing is a property of the **name at this receiver**, not
  // of one route: `routes.find` picking some *other* qualifying route would put
  // the broken dot form back the moment a second prelude constraint spelled a
  // structurally-instanced member's name. So it gates the whole dot form.
  const noDotAtVector = written !== undefined && written.vectorLiteral &&
    routes.some((route) => route.structural === true);
  const dotted = written === undefined || written.receiver === undefined ||
      noDotAtVector
    ? undefined
    : routes.find((route) =>
      route.dotCallable === true && route.arity === written.texts.length
    );
  if (dotted !== undefined) {
    const rest = written!.texts.slice(1);
    spellings.push(`\`${written!.receiver!}.${name}(${rest.join(", ")})\``);
  }
  for (const route of routes) {
    spellings.push(qualifiedSpelling(name, route.home, written?.texts));
  }
  return `no bare \`${name}\`; write ` +
    (spellings.length === 1 ? spellings[0]! : conjoin(spellings, "or"));
}

/**
 * Modules §10's row for a bare constructor in an **expression** that neither
 * scope nor rule 3's fallback reaches, but that a visible alias's module
 * exports (#763): `Circle(1.0)` under `import Shape from "./shape"`.
 *
 * The same sentence shape as the prelude refusal above and for the same
 * reason — one bare name, the routes it has, in the program's own words
 * (§5.5's #742 rule). The routes here are qualified spellings only: expression
 * position has no constructor door (§9.13), a constructor has no dot form, and
 * the message names no import — the import the reader would need is already
 * written, which is how the compiler knows the constructor at all.
 */
function bareConstructorMessage(
  name: string,
  qualifications: readonly string[],
  written: WrittenArguments | undefined,
): string {
  const spellings = qualifications.map((qualified) =>
    written === undefined
      ? `\`${qualified}\``
      : `\`${qualified}(${written.texts.join(", ")})\``
  );
  return `no bare \`${name}\`; write ` +
    (spellings.length === 1 ? spellings[0]! : conjoin(spellings, "or"));
}

/** Two spans in the order a reader meets them, so a diagnostic can point in source order. */
function orderedBySource(a: Source.Span, b: Source.Span): readonly [Source.Span, Source.Span] {
  return a.start.offset <= b.start.offset ? [a, b] : [b, a];
}

/**
 * Opens a lambda body with the bindings its pattern parameters destructure
 * through, so everything downstream sees the shape a hand-written destructuring
 * `let` would have produced — the binders having already been classified in the
 * head, where they belong.
 */
function openedWith(
  bindings: readonly Resolved.LetPatternItem[],
  body: Resolved.Expr,
): Resolved.Expr {
  if (bindings.length === 0) return body;
  const items: readonly Resolved.Item[] = body.kind === "Block"
    ? [...bindings, ...body.items]
    : [...bindings, { kind: "ExprItem", expression: body, span: body.span }];
  return { kind: "Block", items, span: body.span };
}

/** One prelude module made implicitly available, with the specifier this module imports it by. */
export interface PreludeImport {
  readonly interface: ModuleInterface;
  readonly specifier: string;
}

export interface ResolveOptions {
  readonly imports?: ReadonlyMap<string, ModuleInterface>;
  readonly symbolBase?: number;
  readonly unionBase?: number;
  readonly recordBase?: number;
  readonly externTypeBase?: number;
  /**
   * The prelude modules, implicitly in scope in every non-prelude module. Their
   * names are seeded into a shadowable fallback scope (local declarations win),
   * and a used-names-only import is synthesized per prelude module that a module
   * references, so emission stays free of unused prelude imports.
   */
  readonly prelude?: readonly PreludeImport[];
  /**
   * Whether this module is a privileged runtime module. Only runtime modules may
   * name the hidden `Node` trie intrinsic (`Node.empty/get/set/copy`); in user
   * code `Node` resolves as an ordinary — and therefore unknown — name, so the
   * intrinsic stays unimportable and invisible. See the persistent-collections
   * design note §5.2.
   */
  readonly runtime?: boolean;
  /**
   * Whether this module is compiled as **standard-library source**, the privilege
   * the intrinsic door is gated on (`spec/intrinsics.md` §5.2). Two seats hold it
   * in v1: the prelude set, and the injected runtime-module set (§5.2's runtime
   * bullet, #365) — each including a project-supplied file at the corresponding
   * injection path or grant, which is the stdlib-developing-itself path.
   *
   * The privilege attaches to *how the module is compiled*, never to its text, and
   * unlike `runtime` it puts no name into scope: the door is a declaration form,
   * so there is nothing for unprivileged source to leak (§5.3). All an
   * unprivileged module can even type is the reserved specifier, which fails
   * closed with a named rewrite.
   */
  readonly privileged?: boolean;
  /**
   * The primitive this module is the fixed prelude companion of, when it is one
   * (`Resolved.Module.companionPrimitive` — #344). Settled by the caller from
   * the injection path and never from the module's text, because a primitive has
   * no declaration for text to point at.
   */
  readonly companionPrimitive?: Resolved.PrimitiveName;
  /**
   * This module's project-root-normalized path — the same string
   * `compileProject` keys its module map on.
   *
   * Two things are built from it and nothing else is: `Resolved.Module.path`,
   * and the `declaringPath` stamped on every union and record *this* module
   * declares. Both exist for Collections Part 5 §3.3's diagnostic, which names
   * the file a missing `Iterable` instance belongs in; the path is normalized
   * against the project root precisely so an importing module inherits it by
   * plain copy and relativizes once, at the message, against its own path.
   *
   * Like `privileged` and `companionPrimitive`, it is settled by the caller and
   * never by the module's text — a file does not know where it lives.
   */
  readonly path?: string;
  /**
   * This module's source text, for the one diagnostic that quotes the program
   * back to itself: Modules §10's refusal of a bare prelude name, whose routes
   * are spelled **with the call's own arguments** (§5.5 — "the message invents
   * no identifier the program does not contain"). Nothing else reads it, and a
   * caller that omits it gets the non-call form of that message, which names
   * qualified spellings alone and is always well-formed.
   */
  readonly text?: string;
  /**
   * This module's **brand identity** (`spec/exceptions.md` §7.1, #488): the
   * string every exception declared here carries as `$hex`, and the literal its
   * `.d.ts` face publishes.
   *
   * A module's identity in Hexagon is its path (Modules §2), so the spelling is
   * the project-root-relative path with forward slashes, the `.hex` extension
   * dropped and no leading slash — `client/errors.hex` is `"client/errors"` —
   * except for an injected module, which brands its **canonical injected name**
   * (`"Seq"`, `"Vector"`, `"Map"`) wherever in the project its file happens to
   * sit. Only `compileProject` knows the project root and the injection set, so
   * only it can spell this; like `path` and `privileged`, it is settled by the
   * caller and never by the module's text.
   *
   * Absent for a pass-level harness that compiles a module with no project
   * around it, which brands `""` — one module, no second identity to be
   * distinguished from.
   */
  readonly identity?: string;
}

export function resolve(
  module: Parsed.Module,
  options: ResolveOptions = {},
): Resolved.Module {
  const diagnostics = new Diagnostics.Bag();
  for (const diagnostic of module.diagnostics) diagnostics.add(diagnostic);

  return new Resolver(diagnostics, options).resolve(module);
}

/**
 * What kind of binding an `extern` block's declarations produce.
 *
 * A foreign one is `extern` — the value came from outside and the compiler knows
 * nothing about it beyond the declaration it was asked to believe. An intrinsic
 * one is `fun`, because that is what `spec/intrinsics.md` §3.1 makes it: "After
 * the declaration, the binding is an **ordinary module-level binding**: same
 * typing, visibility, collision, and occlusion rules as any other." §8.1 spends
 * that immediately — Method Syntax §4.2's companion operation set is built from
 * ordinary function bindings, and an exported intrinsic declaration has to be in
 * it for `source.memoize()` to dispatch the way every sibling combinator does.
 */
function externBindingKind(specifier: string): "fun" | "extern" {
  return isIntrinsicScheme(specifier) ? "fun" : "extern";
}

/**
 * A dictionary's preferred spelling: Dictionary Sharing §5's family
 * `__<Constraint>_<Subject>`, sitting directly under Lexer §3.2's reserved `__`
 * prefix like every other generated name (#425).
 *
 * Read `__Eq_Rat` as "honor `Eq<Rat>`". The flattening is not injective —
 * underscores are legal in constraint and type-constructor names — which is one
 * of the two reasons `nameDictionaries` exists.
 */
export function dictionaryName(constraint: string, subject: string): string {
  return `__${constraint}_${subject}`;
}

/**
 * A member seat's preferred spelling: the dictionary family's name with the
 * member appended (`spec/constraints.md` §6.1 — a generated family keyed
 * (constraint, subject, member), which is what `__Show_Int_show` reads as).
 *
 * `dictionary` is the instance's *preferred* spelling, never a suffixed local:
 * seats and dictionaries are one rank assigned in one pass, so a seat that read
 * a neighbour's already-resolved local would depend on the order the pass
 * happened to visit them in.
 */
export function memberSeatName(dictionary: string, member: string): string {
  return `${dictionary}_${member}`;
}

/**
 * Dictionary Sharing §5's naming and collision rules, applied once per module
 * over every dictionary that will hold a module-level seat (#425).
 *
 * Two things are decided here, and nothing else is:
 *
 * - **Imported names are unaliased by default.** A consumer binds an imported
 *   dictionary under the exporter's interface name, read from the resolved
 *   interface, whenever that spelling is uncontested. The unconditional
 *   per-file alias prefix this replaced meant a re-export chain grew a prefix
 *   per hop; re-binding the interface name at each hop is what stops the
 *   compounding.
 * - **A contested spelling suffixes every contestant.** When more than one
 *   dictionary wants one spelling, all of them take `_1`-upward suffixes and
 *   none keeps the bare name — so a bare dictionary name certifies that its
 *   spelling is uncontested in the module it appears in. Suffixes are assigned
 *   in the canonical order §5 fixes: declared instances in declaration order,
 *   each followed by its **member seats** in member declaration order
 *   (Constraints §6.1, #444), then hoisted bindings in emission order, then
 *   imports in specifier order, with the prelude channel last. Same module,
 *   same names, every compile.
 *
 *   A seat is a declared contestant in every sense, §8's export clause
 *   included: it keeps the bare spelling at the interface unless another
 *   declared name of the module contests it, so a consumer routing a concrete
 *   member call reads an uncontested name and predicts nothing.
 *
 *   The **hoisted** rank is not assigned here, and cannot be (#449): a hoisted
 *   binding exists only because some use site demanded its ground evidence
 *   tree, and those trees are the checker's output — they do not exist when
 *   this runs. The emitter mints those names against the seats decided here,
 *   through Lexer §3.2's probe, so a hoisted binding steps aside rather than
 *   pushing a declared instance off its spelling. That is narrower than §5's
 *   "none keeps the bare name" whenever a hoisted binding is one of the
 *   contestants; `dictionary-sharing.test.ts` pins what happens instead.
 *
 * Two arrivals of the *same* dictionary are not a contest: the same identity
 * reaching a module by two routes (a diamond of re-exports, or an import beside
 * a direct one) is one dictionary and takes one seat, under one name. Emission
 * binds it once — see the emitter's import rendering.
 *
 * §8's export rule is decided here too, because it is the same assignment read
 * from the other side, and it turns on **declared**, not on exported: the
 * plumbing sweep re-exports every imported dictionary in transit, so "exported"
 * would name almost everything and decide nothing. A declared instance keeps the
 * bare spelling at the interface unless another *declared* instance of the same
 * module contests it — nothing arriving from outside can rename a module's own
 * instance out from under its consumers. A transit copy is the other side of
 * that: it carries its §5 suffix at the interface whenever a declared instance
 * or another transit copy contests the spelling, and re-binds its incoming
 * interface name when the only contest is with an internal name.
 */
export function nameDictionaries(
  items: readonly Resolved.Item[],
  preludeInstances: readonly Resolved.PreludeInstance[],
): {
  readonly items: readonly Resolved.Item[];
  readonly preludeInstances: readonly Resolved.PreludeInstance[];
} {
  interface Seat {
    readonly preferred: string;
    /** Declared here, rather than arriving through an import. */
    readonly declared: boolean;
    local: string;
  }
  const byIdentity = new Map<string, Seat>();
  const groups = new Map<string, Seat[]>();
  const seat = (preferred: string, declared: boolean): Seat => {
    const entry: Seat = { preferred, declared, local: preferred };
    const group = groups.get(preferred);
    if (group === undefined) groups.set(preferred, [entry]);
    else group.push(entry);
    return entry;
  };
  const importedSeat = (identity: string, preferred: string): Seat => {
    const existing = byIdentity.get(identity);
    if (existing !== undefined) return existing;
    const entry = seat(preferred, false);
    byIdentity.set(identity, entry);
    return entry;
  };

  const declaredSeats = new Map<Resolved.HonorItem, Seat>();
  const memberSeats = new Map<Resolved.HonorItem, Seat[]>();
  for (const item of items) {
    if (item.kind !== "Honor") continue;
    declaredSeats.set(item, seat(item.dictionary, true));
    // §5's canonical order: "member seats with their instance in member
    // declaration order". With their instance, so a member seat is a declared
    // contestant seated immediately behind the record it fills — not a rank of
    // its own after every dictionary.
    memberSeats.set(
      item,
      item.memberSeats.map(({ seat: preferred }) => seat(preferred, true)),
    );
  }
  const importedSeats = new Map<Resolved.InstanceImport | Resolved.PreludeInstance, Seat>();
  for (const item of items) {
    if (item.kind !== "Import") continue;
    for (const instance of item.instances) {
      importedSeats.set(
        instance,
        importedSeat(instance.identity, instance.importedDictionary),
      );
    }
  }
  for (const instance of preludeInstances) {
    importedSeats.set(
      instance,
      importedSeat(instance.identity, instance.importedDictionary),
    );
  }

  // Nothing contested, nothing to rewrite — the overwhelmingly common shape.
  if ([...groups.values()].every((group) => group.length === 1)) {
    return { items, preludeInstances };
  }

  const taken = new Set(groups.keys());
  for (const group of groups.values()) {
    if (group.length === 1) continue;
    let suffix = 1;
    for (const entry of group) {
      let candidate = `${entry.preferred}_${suffix}`;
      // A suffixed spelling can itself be some other dictionary's preferred one
      // (`__Eq_Rat_1` is what `honor Eq_Rat_1<...>` would want). Keep probing —
      // §5's rule is "rename everything renameable", and the numbering stays
      // deterministic because the candidate order is.
      while (taken.has(candidate)) candidate = `${entry.preferred}_${++suffix}`;
      taken.add(candidate);
      entry.local = candidate;
      suffix += 1;
    }
  }

  /** §8: the spelling this module's *interface* publishes for a declared seat. */
  const exportedName = (entry: Seat): string => {
    const group = groups.get(entry.preferred) ?? [];
    return group.filter(({ declared }) => declared).length > 1
      ? entry.local
      : entry.preferred;
  };

  return {
    items: items.map((item): Resolved.Item => {
      if (item.kind === "Honor") {
        const entry = declaredSeats.get(item)!;
        const exported = exportedName(entry);
        const seats = memberSeats.get(item) ?? [];
        return {
          ...item,
          dictionary: entry.local,
          ...(exported === entry.local ? {} : { exportedDictionary: exported }),
          memberSeats: item.memberSeats.map(({ member }, index) => {
            const assigned = seats[index]!;
            const exportedSeat = exportedName(assigned);
            return {
              member,
              seat: assigned.local,
              ...(exportedSeat === assigned.local ? {} : { exportedSeat }),
            };
          }),
        };
      }
      if (item.kind !== "Import") return item;
      return {
        ...item,
        instances: item.instances.map((instance) => ({
          ...instance,
          localDictionary: importedSeats.get(instance)!.local,
        })),
      };
    }),
    preludeInstances: preludeInstances.map((instance) => ({
      ...instance,
      localDictionary: importedSeats.get(instance)!.local,
    })),
  };
}

export function moduleInterface(module: Resolved.Module): ModuleInterface {
  const symbols = new Map(module.symbols.map((symbol) => [symbol.id, symbol]));
  const terms = new Map<string, Resolved.Symbol>();
  const unions = new Map<string, Resolved.Union>();
  const records = new Map<string, Resolved.RecordDeclaration>();
  const exceptions = new Map<string, Resolved.ExceptionItem>();
  const aliases = new Map<string, Resolved.TypeAliasItem>();
  const externTypes = new Map<string, Resolved.ExternTypeDeclaration>();
  const discoveredInstances: InstanceInterface[] = module.items.flatMap((item): InstanceInterface[] => {
    if (item.kind === "Honor") {
      return [{
        identity: `${Number(module.fileId)}:${item.dictionary}`,
        constraint: item.constraint,
        constraintIdentity: item.constraintIdentity,
        typeParameters: item.typeParameters,
        subject: item.subject,
        impliedTypes: item.impliedTypes,
        // §8: the interface publishes the bare spelling even when a local
        // collision suffixed the binding behind it. Only a *declared*-versus-
        // declared contest pushes a suffix this far — an import or a hoisted
        // binding never outranks the module's own instance for its interface
        // name — and then `exportedDictionary` is the suffixed name itself.
        dictionary: item.exportedDictionary ?? item.dictionary,
        // The declaring module's own answer, at the one seat that holds it: a
        // `derives` clause and a `= derive` body both land here as `derived`,
        // and neither is visible to any consumer (#644).
        derived: item.derived,
        // §8's export clause read from the other side, seat by seat: the bare
        // spelling unless a declared-versus-declared contest pushed a suffix
        // this far. `declaringPath` is this module's, because this is the arm
        // where the instance is declared.
        memberSeats: item.memberSeats.map(({ member, seat, exportedSeat }) => ({
          member,
          seat: exportedSeat ?? seat,
        })),
        ...(module.path === undefined ? {} : { declaringPath: module.path }),
        span: item.span,
      }];
    }
    if (item.kind !== "Import") return [];
    return item.instances.map((instance) => ({
      identity: instance.identity,
      constraint: instance.constraint,
      constraintIdentity: instance.constraintIdentity,
      typeParameters: instance.typeParameters,
      subject: instance.subject,
      impliedTypes: instance.impliedTypes,
      dictionary: instance.localDictionary,
      // Untouched in transit: the seats belong to the declaring module and are
      // reached there, never through the hop that carried the dictionary, and
      // `derived` is the declaring module's word in the same way.
      derived: instance.derived,
      memberSeats: instance.memberSeats,
      ...(instance.declaringPath === undefined
        ? {}
        : { declaringPath: instance.declaringPath }),
      span: instance.span,
    }));
  });
  const instances = [...new Map(
    discoveredInstances.map((instance) => [instance.identity, instance]),
  ).values()];
  const constraints = new Map<string, Resolved.ConstraintItem>();
  const constraintMembers = new Map<string, Resolved.Symbol>();
  // Local declarations first, then what this module's own imports reached. Both
  // halves are metadata; only the exported local ones become nameable above.
  const visible = new Map<string, Resolved.ConstraintItem>();
  for (const item of module.items) {
    if (item.kind !== "ConstraintDeclaration") continue;
    visible.set(item.identity, item);
    if (!item.exported) continue;
    constraints.set(item.name, item);
    for (const member of item.members) {
      const symbol = symbols.get(member.binding.symbol);
      if (symbol !== undefined) constraintMembers.set(member.binding.name, symbol);
    }
  }
  for (const declaration of module.visibleConstraints) {
    if (!visible.has(declaration.identity)) visible.set(declaration.identity, declaration);
  }
  for (const item of module.items) {
    if (item.kind === "ExternBlock") {
      for (const declaration of item.declarations) {
        if (!declaration.exported) continue;
        if (declaration.kind === "ExternType") externTypes.set(declaration.localName, declaration);
        else {
          const symbol = symbols.get(declaration.binding.symbol);
          if (symbol !== undefined) terms.set(declaration.localName, symbol);
        }
      }
      continue;
    }
    if (!('exported' in item) || item.exported !== true) continue;
    if (item.kind === "Let" || item.kind === "Fun") {
      const symbol = symbols.get(item.binding.symbol);
      if (symbol !== undefined) terms.set(item.binding.name, symbol);
    } else if (item.kind === "TypeAlias") {
      aliases.set(item.name, item);
    } else if (item.kind === "Union") {
      const union = module.unions.find(({ id }) => id === item.union);
      if (union !== undefined) unions.set(item.name, union);
      for (const constructor of item.opaque ? [] : item.constructors) {
        const symbol = symbols.get(constructor.binding.symbol);
        if (symbol !== undefined) terms.set(constructor.binding.name, symbol);
      }
    } else if (item.kind === "RecordDeclaration") {
      const record = module.records.find(({ id }) => id === item.record);
      const symbol = symbols.get(item.constructor.symbol);
      if (record !== undefined) records.set(item.name, record);
      if (!item.opaque && symbol !== undefined) terms.set(item.name, symbol);
    } else if (item.kind === "Exception") {
      const symbol = symbols.get(item.binding.symbol);
      if (symbol !== undefined) terms.set(item.binding.name, symbol);
      exceptions.set(item.binding.name, item);
    }
  }
  // Modules §5.3's generalisation law, read off the declaration form: a
  // `widens` binding is a member's wider face and shares its visibility rule
  // (Constraints §4.7, #546). Before the form existed this was a spelling
  // coincidence the interface had to guess at.
  const widensBindings = new Set(
    module.items.flatMap((item) =>
      item.kind === "Let" && item.widens !== undefined ? [item.binding.name] : []
    ),
  );
  return {
    module,
    terms,
    unions,
    records,
    exceptions,
    aliases,
    externTypes,
    instances,
    constraints,
    constraintMembers,
    visibleConstraints: [...visible.values()],
    widensBindings,
  };
}

/**
 * What a module's internal export spellings are computed from, for
 * `Resolved.ImportItem.internalNames` — see its documentation for why an
 * importer is given the inputs rather than the names.
 *
 * Both clauses are the emitter's own-module enumerations on the far side, item
 * kind for item kind: `constraints` is what `moduleInterface` fills from this
 * module's `export constraint` items and nothing else, and the term walk reads
 * the declaration's own items rather than the interface's `terms` map, because
 * that map also holds constructors and exception names — which mint no internal
 * spelling and, being uppercase-start, can contest none either. Counting them
 * on one side only is the way the two sides would drift.
 *
 * Exported for the one import the resolver does not write: Method Syntax §8.2's
 * added companion import (#585), which emission mints for a dot call that
 * reached a module no import item here names. It has to read the exporter's
 * spellings by the same rule as every written import, and that rule is this
 * function rather than a description of it.
 */
export function internalNameInputs(
  imported: ModuleInterface | undefined,
): Resolved.InternalNameInputs {
  if (imported === undefined) return { members: [], terms: [] };
  const members = [...imported.constraints.values()].flatMap((declaration) =>
    declaration.members.map(({ binding, defaultValue }) => ({
      name: binding.name,
      defaulted: defaultValue !== undefined,
    }))
  );
  const terms = imported.module.items.flatMap((item) => {
    if (item.kind === "ExternBlock") {
      return item.declarations.flatMap((declaration) =>
        declaration.exported && declaration.kind !== "ExternType"
          ? [declaration.localName]
          : []
      );
    }
    return (item.kind === "Let" || item.kind === "Fun") && item.exported
      ? [item.binding.name]
      : [];
  });
  return { members, terms };
}

/**
 * The exported terms whose value form admits Algorithm N editions, for
 * `Resolved.ImportItem.specializableTerms` — see its documentation for why the
 * fact travels instead of being predicted from the scheme.
 *
 * The predicate is `isSpecializable` in the emitter's `specializations.ts`,
 * item kind for item kind, and the two must stay in step: an over-report is a
 * call to an edition the exporter never wrote, an under-report is only a missed
 * optimization. A foreign row mints no edition and is absent for that reason —
 * `extern` declarations carry no Hexagon body to specialize.
 */
function specializableTerms(
  imported: ModuleInterface | undefined,
): readonly string[] {
  if (imported === undefined) return [];
  return imported.module.items.flatMap((item) =>
    (item.kind === "Fun" || (item.kind === "Let" && item.value.kind === "Lambda")) &&
      item.exported
      ? [item.binding.name]
      : []
  );
}

class Scope {
  readonly #bindings = new Map<string, Resolved.SymbolId>();
  /**
   * Every binding in the order it was made, kept alongside the lookup map for
   * `Resolved.Module.scopes`. The map cannot serve: it holds only the *winner*
   * for each name, and it has no record of where a binding became visible.
   */
  readonly recorded: Resolved.ScopeBinding[] = [];
  /**
   * The source this scope governs. Assigned after construction only for the
   * prelude layer, which exists before there is a module to measure.
   */
  region: Source.Span | undefined;

  constructor(readonly parent?: Scope, region?: Source.Span, readonly body = false) {
    this.region = region;
  }

  /**
   * @param visibleFrom Where the name comes into scope, for a binder that does
   * not scope over its whole region. Sequential `let` and `var` are the only
   * ones; everything else is declared before the region's body is walked.
   */
  define(name: string, symbol: Resolved.SymbolId, visibleFrom?: number): void {
    this.#bindings.set(name, symbol);
    this.recorded.push({
      name,
      symbol,
      visibleFrom: visibleFrom ?? this.region?.start.offset ?? 0,
    });
  }

  lookupLocal(name: string): Resolved.SymbolId | undefined {
    return this.#bindings.get(name);
  }

  lookup(name: string): Resolved.SymbolId | undefined {
    return this.#bindings.get(name) ?? this.parent?.lookup(name);
  }

  /**
   * The scope `lookup` would answer from, or `undefined` if nothing binds the
   * name. What the symbol alone cannot tell a caller: a prelude term and an
   * explicit import of that same term are one `SymbolId`, so "did this reference
   * land on the prelude layer?" is a question about the *layer* that held it.
   */
  lookupOwner(name: string): Scope | undefined {
    if (this.#bindings.has(name)) return this;
    return this.parent?.lookupOwner(name);
  }
}

class Resolver {
  readonly #symbols = new Map<Resolved.SymbolId, Resolved.Symbol>();
  readonly #importedSymbols = new Map<Resolved.SymbolId, Resolved.Symbol>();
  /** The honor-block member currently being resolved (Constraints §4.6). */
  readonly #honorMembers: Parsed.Name[] = [];
  /** Whether resolution is inside a constraint declaration's default body. */
  #inDefaultBody = false;
  /** Where this module's `honor` declarations bind each spelling (§4.6). */
  readonly #honoredMemberLines = new Map<string, HonoredMemberLine[]>();
  /**
   * The member spellings this module **binds at module level** — the members an
   * `honor` block *writes* (Constraints §4.6), and nothing else.
   *
   * Deliberately narrower than `#honoredMemberLines` beside it, which is the
   * index §4.6's three *laws* read and therefore covers every member an instance
   * binds however it came by one: a `derives` clause's, and a block's defaulted
   * members too. Those laws are about what a spelling *means* here, and they are
   * right to reach that wide.
   *
   * Modules §5.5's carve-out is a different question — which spellings this
   * module puts back into bare scope — and it turns on the module having written
   * a block. A `derives (Ord)` writes none: the instance is the compiler's, and a
   * module that derived one was never *writing* the member. Seeding off the wider
   * index gave such a module nineteen bare names and let `compare(1, 2)` compile
   * in it, which is ruling 4 undone by an implementation detail (#753 review).
   *
   * A written block contributes its **completed** member set, defaults included:
   * an omitted default is bound here too, as the wrapper seat the emitter hoists
   * for it, and the corpus has pinned its bare reachability since Constraints
   * §2's defaults landed.
   */
  readonly #boundHonoredMembers = new Set<string>();
  readonly #unions: Resolved.Union[] = [];
  readonly #records: Resolved.RecordDeclaration[] = [];
  readonly #externTypes: Resolved.ExternTypeDeclaration[] = [];
  readonly #unionNames = new Map<string, Resolved.UnionId>();
  readonly #unionArities = new Map<string, number>();
  readonly #recordNames = new Map<string, Resolved.RecordId>();
  /** Record identities the prelude supplies, by name, immune to local occlusion. */
  readonly #preludeRecords = new Map<string, Resolved.RecordId>();
  /** Union identities the prelude supplies, by name, immune to local occlusion. */
  readonly #preludeUnions = new Map<string, Resolved.UnionId>();
  readonly #recordArities = new Map<string, number>();
  readonly #externTypeNames = new Map<string, Resolved.ExternTypeId>();
  readonly #typeAliases = new Map<string, Parsed.TypeAliasItem | Resolved.TypeAliasItem>();
  readonly #unionDeclarations = new WeakMap<Parsed.UnionItem, Resolved.UnionId>();
  readonly #recordDeclarations = new WeakMap<Parsed.RecordItem, Resolved.RecordId>();
  readonly #externTypeDeclarations = new WeakMap<Parsed.ExternTypeDeclaration, Resolved.ExternTypeId>();
  readonly #resolvingAliases: string[] = [];
  readonly #imports: ReadonlyMap<string, ModuleInterface>;
  readonly #runtime: boolean;
  readonly #privileged: boolean;
  readonly #companionPrimitive: Resolved.PrimitiveName | undefined;
  /** This module's own path; see `ResolveOptions.path`. */
  readonly #path: string | undefined;
  /** This module's brand identity; see `ResolveOptions.identity`. */
  readonly #identity: string;
  /** This module's source text; see `ResolveOptions.text`. */
  readonly #text: string | undefined;
  /**
   * The call whose callee is being resolved, when that callee is a bare name.
   *
   * Modules §5.5 spells a refused prelude name's routes with **the call's own
   * arguments**, and the refusal is raised where the name fails to resolve — one
   * frame below the call. Rather than thread a context parameter through every
   * expression form, the `Call` case parks its own node here for exactly the
   * length of its callee's resolution, and the refusal reads it by identity: a
   * name that is not this call's callee (an argument, say) finds nothing and
   * takes the non-call form.
   */
  #calleeOf: Parsed.CallExpr | undefined;
  /**
   * The expression standing as the right operand of a `|>`, while it is being
   * resolved — the one call shape whose written arguments are not the call's
   * own (see `#writtenArguments`). Parked by the `Binary` case exactly as
   * `#calleeOf` is by the `Call` case, and compared by identity.
   */
  #pipeStage: Parsed.Expr | undefined;
  readonly #preludeScope = new Scope();
  /** Every scope opened, in the order they were opened — see `Module.scopes`. */
  readonly #openScopes: Scope[] = [];
  /**
   * Where a *sequential* pattern binder comes into scope: the end of the `let`
   * that introduced it. Held here rather than threaded through
   * `#resolvePattern`, which recurses a dozen ways and would carry the value
   * unchanged down every one of them; only the one caller that classifies its
   * binders as sequential ever sets it.
   */
  #sequentialVisibleFrom: number | undefined;
  #moduleScope: Scope | undefined;
  readonly #preludeTerms = new Map<Resolved.SymbolId, Resolved.Symbol>();
  readonly #preludeTypeNames = new Set<string>();
  readonly #preludeSpecifierBySymbol = new Map<Resolved.SymbolId, string>();
  readonly #preludeInterfaceBySpecifier = new Map<string, ModuleInterface>();
  /**
   * File ids of the prelude modules visible here — how an *explicit* import is
   * recognized as naming one (#263). By module identity rather than by
   * specifier: the same module is `./Option` from the root and `../Option` from
   * a subdirectory, and a predicate reading the text would answer differently
   * for one module.
   */
  readonly #preludeFileIds = new Set<number>();
  /**
   * The prelude's importable type inventory (FFI Part 7 §2.4), accumulated in
   * `#seedPrelude` and published as `Module.preludeTypeImports`.
   *
   * Mutable only in `explicitLocal`, which is settled later: an explicit import
   * of the same identity takes over the entry's emission, and whether one exists
   * is not known until the import items have been resolved.
   */
  readonly #preludeTypeImports: {
    -readonly [K in keyof Resolved.PreludeTypeImport]: Resolved.PreludeTypeImport[K];
  }[] = [];
  readonly #usedPreludeSymbols = new Set<Resolved.SymbolId>();
  /**
   * Every prelude term of a given name, in prelude order — *not* only the one
   * `#preludeScope` holds. Two prelude members may export the same bare name
   * (`length`, `prepend`, `empty` are `Seq.hex`'s and `Vector.hex`'s alike, per
   * Collections Part 1 §3.1's naming doctrine), and the scope keeps the last,
   * which is the answer to the *bare* spelling and to nothing else.
   * `#noteCompanionCandidate` needs them all: dot call is type-directed
   * (Method Syntax §1), so a `Seq` receiver reaches `Seq.hex`'s `length` however
   * many later members occlude the bare name.
   */
  readonly #preludeTermsByName = new Map<string, Resolved.SymbolId[]>();
  /**
   * The qualified home of every prelude term of a given name, in prelude order —
   * the module names `#preludeModuleAliases` binds, which are what a rewrite of a
   * bare reference has to be spelled with.
   *
   * Two or more homes is a **collision**, and a bare reference to a collided name
   * is refused: neither member owns the spelling, so the reference is an error
   * that names every home (the F#/ML answer — `List.map` and `Seq.map` coexist
   * and the use site qualifies). The alternative the scope gives for free, last
   * member wins, silently changes what a bare `empty` means in every program
   * already written the moment a member joins the prelude.
   *
   * Keyed by *visible* homes, not by the prelude list: this map is filled from
   * the members seeded into this resolver, and a prelude member is seeded only
   * the members before it (Modules §5.5). So `empty` is ambiguous in a consumer,
   * which sees `Seq.hex` and `Vector.hex` both, and ordinary inside `Result.hex`,
   * which sees only the first.
   */
  readonly #preludeHomesByName = new Map<string, string[]>();
  /**
   * Every prelude term name **outside the bare set** (Modules §5.5, #742), with
   * the routes its refusal names — in prelude order, one entry per visible
   * exporter.
   *
   * The bare layer holds sixteen names; every other prelude export reaches a
   * consumer by the dot or the qualified spelling, and a bare reference to one
   * is not an unknown name but a name whose routes the reader has to be told
   * (§10's three rows). Recording the routes at seeding time is the only place
   * the facts are all present at once: the exporter's basename is the alias
   * `#preludeModuleAliases` was keyed by, the parameter names are the
   * declaration's, and the visible prefix is what decides which exporters count.
   *
   * Keyed by *visible* homes for the same reason `#preludeHomesByName` is: a
   * prelude module sees only its predecessors, so inside `Result.hex` a name
   * `Vector.hex` also exports has one route here, not two.
   */
  readonly #qualifiedOnlyPreludeNames = new Map<string, PreludeRoute[]>();
  /**
   * Every prelude **constraint member** the bare layer does not hold, by name —
   * the symbols `#seedHonoredMemberSpellings` puts back for a module that honors
   * the constraint (Modules §5.5's "a member's *in-module* spelling is
   * untouched").
   */
  readonly #preludeMembersByName = new Map<string, Resolved.SymbolId>();
  readonly #moduleAliases = new Map<string, ModuleInterface>();
  /**
   * The specifier each alias was imported from, as the module wrote it.
   *
   * Only a diagnostic reads this: the named-import repair a bare alias in type
   * position gets offered has to be a line the user can type, and the exporter's
   * own path is not that line — the route from here is what the import already
   * spells.
   */
  readonly #moduleAliasSpecifiers = new Map<string, string>();
  /**
   * The `import module` aliases whose item the walk has not reached yet, each
   * mapped to the alias's own name node.
   *
   * Modules §3 splits the alias: `Lib.Point` in an annotation is a type-position
   * mention and order-free, while `Lib.area(x)` and `Lib.Circle(r)` are locals
   * this line binds in the term namespace (§3.3) and read top-down. So the alias
   * is registered in `#moduleAliases` before any item is walked — that is what
   * makes the type half work above the line — and every *term*-position door
   * checks this set first, reporting §7.2's declared-later error with the
   * import's own repair while the entry stands.
   */
  readonly #pendingImportAliases = new Map<string, Parsed.Name>();
  /** What each import item's type half bound; see `#predeclareImports`. */
  readonly #importTypeBindings = new Map<Parsed.Item, ImportTypeBindings>();
  /** Prelude members addressable by name — a fallback layer, so an explicit
   *  `import module` of the same name is a module-level binding and wins (§5.4). */
  readonly #preludeModuleAliases = new Map<string, ModuleInterface>();
  /**
   * The names a `constraint` declaration may not take, growing as the module's
   * own declarations are resolved. Seeded from the pre-registered inventory,
   * whose one declaration the compiler holds (§5.1.1) — a module-level twin is
   * refused rather than admitted as a name the wired-in machinery cannot reach.
   *
   * **Not seeded in privileged (standard-library) source.** A privileged
   * declaration of a pre-registered name is not a twin; it is the stdlib
   * *supplying* the declaration the compiler pre-registered by name — the
   * intrinsic-door move applied to a constraint declaration (the
   * constraint-members-are-values note §6 step 2, #335). `#constraintIdentity`'s
   * pre-registration-wins rule then lands the declaration on the compiler-global
   * `hex:` identity, so the wired-in machinery and the source declaration are
   * one constraint by construction, exactly as `stdlib/Integral.hex`'s already
   * is. The privilege carries the same trust model as the rest of `privileged`:
   * it attaches to how the module is compiled, and the embedded-source drift
   * guard pins what that source says.
   */
  readonly #constraintNames = new Set<string>();
  /**
   * The constraint names this module's own `constraint` declarations take,
   * collected before any item is resolved.
   *
   * Read by `#constraintIdentity` so that a module which both declares `C` and
   * imports one keeps its own declaration's identity for its own text. That the
   * pair is also a reported collision is beside the point: the identity has to
   * be a function of the name either way, and answering it from source order
   * would make the erroneous program's two halves disagree about which `C` they
   * meant.
   */
  readonly #declaredConstraintNames = new Set<string>();
  /** Imported constraints by `Alias.Name`, for the §3.1 binder position. */
  readonly #qualifiedConstraints = new Map<string, Resolved.ConstraintItem>();
  /**
   * Constraints the **companion fallback** answers with, by the bare name they
   * answer for (Modules §5.1 rule 2, #531).
   *
   * An entry here binds nothing, so it is consulted last everywhere and
   * enters no collision set.
   * `#registerCompanionConstraints` fills it only for names the constraint
   * namespace left unclaimed.
   */
  readonly #companionConstraints = new Map<string, Resolved.ConstraintItem>();
  /** Every constraint declaration the import graph reaches, by identity. */
  readonly #visibleConstraints = new Map<string, Resolved.ConstraintItem>();
  /**
   * Every exception declaration the prelude layer and this module's imports
   * bring, by constructor symbol — `Module.visibleExceptions`. This module's own
   * are its items and are deliberately absent.
   */
  readonly #visibleExceptions = new Map<Resolved.SymbolId, Resolved.ExceptionItem>();
  readonly #impliedTypeOwners = new Map<string, Set<string>>();
  readonly #pending: { readonly name: Parsed.Name; readonly kind: "let" | "var" }[] = [];
  readonly #predeclaredBindings = new WeakMap<Parsed.FunItem | Parsed.ExternFunDeclaration | Parsed.ExternLetDeclaration, Resolved.Binding>();
  readonly #blockDeclarations: BlockDeclarations[] = [];
  readonly #currentFunctions: Resolved.SymbolId[] = [];
  readonly #varOwners = new Map<Resolved.SymbolId, number>();
  readonly #diagnostics: Diagnostics.Bag;
  /** This module's file id, held for identity minting; set by `resolve`. */
  #fileId = 0;
  /**
   * The same id, unbranded rather than numbered: a `TypeQualifier` records which
   * module *wrote* the qualifier, and only that module may read it back (FFI
   * Part 7 §2.4). Held beside `#fileId` because that one is a `number` for the
   * identity arithmetic and this one has to be the branded id it is compared to.
   */
  #moduleFileId = 0 as unknown as Source.FileId;
  #lambdaDepth = 0;
  /** Written-hole identities; see `Resolved.HoleTypeAnnotation.id`. */
  #nextHole = 0;
  #nextSymbol: number;
  #nextUnion: number;
  #nextRecord: number;
  #nextExternType: number;

  constructor(diagnostics: Diagnostics.Bag, options: ResolveOptions) {
    this.#diagnostics = diagnostics;
    this.#imports = options.imports ?? new Map();
    this.#runtime = options.runtime ?? false;
    this.#privileged = options.privileged ?? false;
    this.#companionPrimitive = options.companionPrimitive;
    this.#path = options.path;
    this.#identity = options.identity ?? "";
    this.#text = options.text;
    this.#nextSymbol = options.symbolBase ?? 0;
    this.#nextUnion = options.unionBase ?? 0;
    this.#nextRecord = options.recordBase ?? 0;
    this.#nextExternType = options.externTypeBase ?? 0;
    if (!this.#privileged) {
      for (const name of NON_REDECLARABLE_CONSTRAINTS) this.#constraintNames.add(name);
    }
    for (const preludeImport of options.prelude ?? []) {
      this.#preludeFileIds.add(Number(preludeImport.interface.module.fileId));
      this.#seedPrelude(preludeImport.interface, preludeImport.specifier);
    }
  }

  /**
   * The identity a constraint *name* denotes here (`spec/constraints.md`
   * §5.1.1).
   *
   * Pre-registration wins over a module's own declaration, and that order is
   * load-bearing rather than defensive. It applies to exactly the two names a
   * module may still redeclare (`Iterable`, `Integral` — see
   * `NON_REDECLARABLE_CONSTRAINTS`), and a pre-registered constraint is
   * compiler-global: every module means the same declaration by the name,
   * without importing anything. A source declaration of one is *supplying* that
   * declaration's members, not minting a rival, so it must land on the same
   * identity — otherwise `stdlib/Integral.hex`'s constraint and the `Integral`
   * an importing module demands would be two different constraints.
   *
   * An **imported** constraint keeps the identity its declaring module minted
   * (§6.5's "an exported constraint crosses as a reference to its
   * declaration"), which is the whole point: the importer must not mint one of
   * its own, or the instances the home module already holds would answer a
   * different constraint. This module's own declarations still win over an
   * import of the same name — see `#declaredConstraintNames`.
   *
   * A name that is none of the three names nothing; it is minted file-scoped
   * anyway, which keeps the checker's unknown-constraint report the only
   * diagnostic for that program rather than adding a second, keying one.
   */
  #constraintIdentity(name: string): string {
    const qualified = this.#qualifiedConstraints.get(name);
    if (qualified !== undefined) return qualified.identity;
    if (isPreRegisteredConstraint(name)) return preRegisteredConstraintIdentity(name);
    if (this.#declaredConstraintNames.has(name)) {
      return declaredConstraintIdentity(this.#fileId, name);
    }
    // The companion fallback comes last of the readings and before the mint
    // (§5.1 rule 2): it answers only for names every table above left unclaimed,
    // and it answers with the *declaring* module's identity, exactly as an
    // import does — the fallback resolves to that declaration, not to a rival.
    return this.#companionConstraints.get(name)?.identity ??
      declaredConstraintIdentity(this.#fileId, name);
  }

  /** The declaration a constraint name denotes here, if this module can see it. */
  #namedConstraint(name: string): Resolved.ConstraintItem | undefined {
    return this.#qualifiedConstraints.get(name) ??
      this.#companionConstraints.get(name);
  }

  /**
   * A module addressable by name: an explicit import alias first, then the
   * prelude layer. Modules §6.4 requires every prelude name to have a qualified
   * home; §5.4 makes an explicit alias a module-level binding, so it wins.
   */
  #namedModule(name: string): ModuleInterface | undefined {
    return this.#moduleAliases.get(name) ?? this.#preludeModuleAliases.get(name);
  }

  /**
   * Modules §5.1 rule 3's **companion fallback, term half** (#763): a bare
   * `Name` the term namespace has nothing for resolves to the **constructor**
   * `Name` exported by a visible module alias `Name` — in an expression and in
   * a pattern alike, rule 2 one namespace over.
   *
   * It **answers, never binds**: nothing enters the term namespace, so a
   * same-spelled declaration or binding wins outright with no collision and no
   * refusal, and every call site sits *after* the ordinary lookup. What it
   * answers with is exactly what `Name.Name` would have resolved to — the
   * qualified path's own read, `terms` only — so opacity, arity and emission
   * are identical for both spellings, and an opaque record's constructor stays
   * out of reach abroad exactly as its qualified spelling is.
   *
   * `undefined` means declined; the caller proceeds to whatever answered before
   * the fallback existed.
   */
  #companionConstructor(name: string): Resolved.SymbolId | undefined {
    // Term position reads top-down (Functions §7.2): above the import line the
    // alias is bound but not reached, and the caller reports the declared-later
    // error rather than resolving through it.
    if (this.#pendingImportAliases.has(name)) return undefined;
    const symbol = this.#namedModule(name)?.terms.get(name);
    if (
      symbol === undefined ||
      (symbol.kind !== "constructor" && symbol.kind !== "record-constructor")
    ) {
      return undefined;
    }
    this.#importedSymbols.set(symbol.id, symbol);
    return symbol.id;
  }

  /**
   * The qualified spellings this module can write for a constructor spelling —
   * Modules §10's row for a bare constructor the alias's own name does not
   * reach (`Circle(1.0)` under `import Shape from "./shape"`), and the
   * closed-door refusal's rewrite in a pattern (Pattern Matching §12).
   *
   * Every visible alias is asked, so "exactly one" and "several" are answered
   * by the same walk. A **pending** alias is skipped: its line is below the
   * use, and the repair there is to move the import, not to qualify.
   */
  #constructorQualifications(name: string): readonly string[] {
    const spellings: string[] = [];
    for (const [alias, module] of this.#moduleAliases) {
      if (this.#pendingImportAliases.has(alias)) continue;
      const symbol = module.terms.get(name);
      if (
        symbol !== undefined &&
        (symbol.kind === "constructor" || symbol.kind === "record-constructor")
      ) {
        spellings.push(`${alias}.${name}`);
      }
    }
    return spellings;
  }

  /**
   * The **term**-position half of a qualifier: `Lib.area(x)` in an expression,
   * `Lib.Circle(r)` in a pattern. `Lib.name` is a local this import line binds
   * (Modules §3.3), so it is read top-down like every other term-namespace name
   * an import binds — and above the line it draws §7.2's declared-later error
   * with the import's own repair, not the alias's unknown-module report.
   *
   * The whole qualified spelling is the name in the message, because it is the
   * name the line binds: the alias by itself is not a term.
   *
   * **Only what the line binds**, exactly as for a named import: §3 scopes the
   * top-down error to the names the import brings, so a field the exporter does
   * not offer is no later declaration and "move the import above this use" would
   * be a repair that fixes nothing — moving it only trades this message for the
   * does-not-export one. So the exporter's surface is consulted first, the way
   * `#importTermNames` consults it, and an unoffered field falls through to the
   * read below, which reports what the moved line would have reported.
   *
   * Answers whether it reported, so the caller can stop.
   */
  #reportUnreachedAlias(
    qualifier: Parsed.Name,
    field: Parsed.Name,
    position: "term" | "constructor",
  ): boolean {
    const pending = this.#pendingImportAliases.get(qualifier.text);
    if (pending === undefined) return false;
    // The two maps are written together in `#predeclareImports` and only the
    // pending one is ever emptied, so a pending alias has its exporter here. The
    // fall-through is the safe half of the pair either way: it hands the
    // spelling to the read below, which reports against the same interface.
    const exporter = this.#moduleAliases.get(qualifier.text);
    if (exporter === undefined) return false;
    if (!this.#aliasOffers(exporter, qualifier.text, field, position)) return false;
    const spelling = `${qualifier.text}.${field.text}`;
    this.#diagnostics.add({
      severity: "error",
      message: `\`${spelling}\` is declared later in this block; ` +
        "declarations are read top-down — move the import above this use",
      primary: { fileId: qualifier.span.fileId, start: qualifier.span.start, end: field.span.end },
      labels: [{ span: pending.span, message: "declared here" }],
    });
    return true;
  }

  /**
   * Whether `alias.field` names something the namespace import binds — the same
   * what-*binds* question `#importTermNames` answers for a named import, asked
   * of the alias's qualified spellings.
   *
   * The surfaces are the ones the reads below this line consult, and in two
   * shapes because two reads exist. Term position takes Modules §3.3/§5.3 whole:
   * the exporter's terms, the members of constraints it declares, the members of
   * instances it honors at a type of its own, and the provided row (Collections
   * Part 5 §4) that rides the prelude companion. A **constructor** pattern reads
   * `terms` alone — §5.4 puts pattern and value position in one scope, but a
   * constraint member is not a constructor, so the member surfaces answer
   * nothing there.
   *
   * A superset of what those reads resolve, never a subset. A `false` here sends
   * the spelling on to be read *above* its import, so a surface missed here is a
   * hole in §3's top-down half. Hence the honored arm asks whether a candidate
   * exists rather than whether one wins — an ambiguity refusal is a binding as
   * far as this question goes.
   *
   * The superset is a *loosening* of each surface's own test, never a widening
   * of which surfaces exist. Over-claiming is cheap only where the spelling has
   * a binding either way: claim a name no surface offers and the message is back
   * to promising a repair that fixes nothing, which is the whole point of asking.
   * `PROVIDED_ROW_ALIASES` is where that line ran once — the seating alone
   * admits every prelude basename a project file may take, and only five of them
   * carry a row.
   */
  #aliasOffers(
    iface: ModuleInterface,
    alias: string,
    field: Parsed.Name,
    position: "term" | "constructor",
  ): boolean {
    if (iface.terms.has(field.text)) return true;
    if (position === "constructor") return false;
    if (iface.constraintMembers.has(field.text)) return true;
    if (this.#honoredMemberCandidates(iface, field.text).length > 0) return true;
    if (field.text !== "toSeq" || !PROVIDED_ROW_ALIASES.has(alias)) return false;
    // The seating test `#providedRowMemberAccess` makes, and for its reason: a
    // project's own `import Vector from "./mine"` is not the companion, and
    // the same file reached two ways yields two interfaces, so the comparison is
    // by `fileId`. The alias filter above it is what keeps this from claiming
    // `Int.toSeq` — every prelude basename a project file may take is seated,
    // and only five of them carry a row.
    const companion = this.#preludeModuleAliases.get(alias);
    return companion !== undefined && companion.module.fileId === iface.module.fileId;
  }

  /**
   * Makes a prelude term reachable from emitted code, returning the name to
   * spell it by, or `undefined` if the symbol is not a prelude term.
   *
   * A prelude member has no namespace object to dot into — unlike an explicit
   * `import module`, nothing declares one. So the reference compiles to a plain
   * name backed by the same synthesized used-names-only import the bare spelling
   * uses, and the symbol has to join that set or the emitted module references
   * nothing.
   *
   * The *local* the import binds it under is decided later, in `#preludeImport`,
   * because choosing it here would mean guessing which names the module will go
   * on to bind (PR #91 finding F1). The reference carries the term's own name;
   * emission substitutes the import's local.
   */
  #reachPreludeTerm(symbol: Resolved.SymbolId): string | undefined {
    const term = this.#preludeTerms.get(symbol);
    if (term === undefined) return undefined;
    this.#usedPreludeSymbols.add(symbol);
    return term.name;
  }

  /**
   * Marks a prelude term that *companion dispatch* might reach through this
   * field name. `source.map(f)` names no module, and whether it is a dispatch or
   * a call of a function-valued field depends on the receiver's **type** — which
   * the checker decides, long after the synthesized prelude import is built. So
   * the candidate is registered here, from the one syntactic form dispatch can
   * take. It is conservative in one direction only: at worst a spare candidate,
   * never a missing one.
   *
   * The failure this prevents is the silent kind (defect log entries 8 and 10):
   * the module compiles clean and its emitted JavaScript calls a name it never
   * imported. `Seq.hex` is the first prelude module to export dispatchable
   * lowercase operations, so nothing exercised this before.
   *
   * **Every prelude term of the name, not the one the bare spelling resolves
   * to.** Dispatch consults the receiver's type, so an occluded member is as
   * reachable as the occluding one; registering only `#preludeScope`'s winner
   * made the over-approximation an *under*-approximation the moment two members
   * shared a name, and produced exactly the failure above — a `Seq` receiver's
   * `length` emitted as a bare name that `Vector.hex`'s import had bound.
   *
   * What a spare candidate costs is bounded at one entry in the resolved tree
   * (#263). Registration is *availability* only: emission renders the
   * synthesized import from the names the elaborated Core references, so a
   * candidate no dispatch turned out to need is never imported, never drags the
   * prelude module into the emitted graph, and never reaches this module's
   * public ESM surface. The over-approximation used to pay all three.
   */
  #noteCompanionCandidate(field: string): void {
    for (const symbol of this.#preludeTermsByName.get(field) ?? []) {
      this.#reachPreludeTerm(symbol);
    }
  }

  /**
   * Whether `receiver.field(…)` is a *compiler companion* call — one the `Access`
   * case below turns into a `CollectionOperation`. Those never reach a prelude
   * term: the operation is the compiler's own, resolved by name against a fixed
   * per-collection inventory, so no dispatch candidate exists to register.
   *
   * The conservatism in `#noteCompanionCandidate` is deliberate and stays; this
   * only removes the one case that is decidable *here*, syntactically, with no
   * help from the checker. The emitted output no longer depends on it — since
   * #263 an unreferenced candidate is filtered out at emission — so what it
   * still buys is in the resolved tree: no spare entry in the used-prelude set,
   * and no spare claim on a module-level name, which is what would otherwise
   * push `#preludeImport` into renaming a local it never needed to rename. The
   * collection cores and `Seq.hex` share vocabulary on purpose (`isEmpty`,
   * `empty` — Collections Part 1 §3.1's naming doctrine), so `Set.isEmpty(s)`
   * is an ordinary spelling and not a rarity.
   *
   * The guards mirror the `Access` case below, and must keep mirroring it: a
   * receiver that some declaration claims is *not* the compiler companion, and a
   * candidate must still be registered for it. `Node` carries the field
   * inventory too, because its `Access` case does — outside those four names
   * `Node.x(…)` is an ordinary access, and suppressing there would be a claim
   * this predicate has no right to make.
   */
  #routesToCollectionCore(receiver: Parsed.Expr, field: string, scope: Scope): boolean {
    if (receiver.kind !== "Name") return false;
    const name = receiver.name.text;
    if (scope.lookup(name) !== undefined) return false;
    if (this.#namedModule(name) !== undefined) return false;
    // `Node` alone since #373 retired `Set`'s guard entry, as #370 retired
    // `Map`'s (`spec/intrinsics.md` §9.2's Map/Set milestones). Each entry went
    // because the schedule says so: `stdlib/Map.hex` and `stdlib/Set.hex` are
    // prelude members now, so `#namedModule` above already declines every `Map.`
    // and `Set.` receiver, and leaving either name here would be a claim about a
    // route that no longer exists.
    return this.#runtime && name === "Node" &&
      ["empty", "get", "set", "copy"].includes(field);
  }

  /**
   * Makes one prelude module's nominals implicitly available. Terms go into a
   * fallback scope so a local declaration of the same name shadows the prelude;
   * type identities are registered so annotations resolve and the checker sees
   * them. The specifier is recorded per term so the synthesized import points at
   * the module the name actually came from.
   *
   * Types are recorded twice, and the second record is the one FFI Part 7 §2.4
   * reads: `#preludeTypeNames` and friends are keyed by *name*, which occlusion
   * can move (§5.4), while a face carries an identity. The inventory below is
   * keyed by identity and ordered — the members arrive in normative prelude
   * order, and each member's slice is unions, then records, then extern types.
   */
  #seedPrelude(prelude: ModuleInterface, specifier: string): void {
    this.#preludeInterfaceBySpecifier.set(specifier, prelude);
    const seedTypeName = (name: string): void => {
      this.#preludeTypeNames.add(name);
    };
    const inventory = (
      name: string,
      identity: Pick<Resolved.PreludeTypeImport, "union" | "record" | "externType">,
    ): void => {
      this.#preludeTypeImports.push({ ...identity, name, specifier });
    };
    // Modules §6.4: the occlusion rule's "the prelude version stays reachable
    // qualified" only works if the member can be *named*. Registering it under
    // its own basename gives every prelude name the qualified home §6.4 requires,
    // the same way an explicit `import module` alias would. An explicit alias of
    // the same name is a module-level binding and wins, per §5.4.
    const moduleName = specifier.slice(specifier.lastIndexOf("/") + 1).replace(/\.js$/u, "");
    if (moduleName !== "") this.#preludeModuleAliases.set(moduleName, prelude);
    // **Modules §5.5's channel rules, as three lookups (#742).** Nothing in the
    // term namespace is seeded bare by default; the sets below are what a name
    // has to be in to reach a consumer's bare scope.
    //
    // Every other registration in the terms loop a refused name keeps, and that
    // is what makes its qualified spelling work: `#preludeTermsByName` is the
    // dot-call channel, and `#preludeTerms`/`#importedSymbols` are what let
    // `#qualifiedConstructor` — the same `Geo.Circle(r)` door a user union uses,
    // in expressions and in patterns alike — resolve and synthesize its import.
    // Runtime representations are untouched: an `Ordering` is still its
    // name-string.
    const openConstructors = new Set<string>();
    const qualifiedOnlyConstructors = new Set<string>();
    for (const [name, union] of prelude.unions) {
      for (const constructor of union.constructors) {
        (OPEN_PRELUDE_UNIONS.has(name) ? openConstructors : qualifiedOnlyConstructors)
          .add(constructor.binding.name);
      }
    }
    // A nominal record's constructor is a term of the same name (Modules §4.2),
    // and it is a constructor for this rule like any other: `JsConversionError`
    // is spelled `JsValue.JsConversionError`, in a pattern as in an expression.
    for (const name of prelude.records.keys()) qualifiedOnlyConstructors.add(name);
    // The **exception category** (ruling 3): every prelude exception constructor
    // is bare, with no list and no ruling owed by a future one. The `…Error`
    // suffix is the category's own qualifier.
    const exceptionConstructors = new Set(prelude.exceptions.keys());
    const pervasive = (name: string): boolean =>
      PERVASIVE_PRELUDE_TERMS.has(`${moduleName}.${name}`);
    // Declared parameter names, per exported term, for the refusal's rewrites
    // (§10). Read off the declaration rather than the symbol, which carries no
    // signature — and off `module.items` rather than the interface, which is the
    // only place a door declaration's parameters survive.
    const parametersByName = new Map<string, readonly Resolved.Parameter[]>();
    for (const item of prelude.module.items) {
      if (item.kind === "Fun") parametersByName.set(item.binding.name, item.value.parameters);
      else if (item.kind === "Let" && item.value.kind === "Lambda") {
        parametersByName.set(item.binding.name, item.value.parameters);
      } else if (item.kind === "ExternBlock") {
        for (const declaration of item.declarations) {
          if (declaration.kind === "ExternFun") {
            parametersByName.set(declaration.binding.name, declaration.parameters);
          }
        }
      }
    }
    /**
     * Records the route a refused bare reference to `name` is rewritten through
     * (§10's three rows), appending to the routes earlier members contributed so
     * the enumeration comes out in prelude order.
     */
    const route = (name: string, channel: PreludeRoute["channel"], subject?: string): void => {
      const parameters = channel === "constructor" ? undefined : parametersByName.get(name);
      const first = parameters?.[0]?.annotation;
      this.#qualifiedOnlyPreludeNames.set(name, [
        ...this.#qualifiedOnlyPreludeNames.get(name) ?? [],
        {
          home: moduleName === "" ? specifier : moduleName,
          channel,
          ...(parameters === undefined ? {} : { arity: parameters.length }),
          ...(channel === "member" && structuralMembers.has(name)
            ? { structural: true as const }
            : {}),
          ...(first !== undefined &&
              (subject === undefined
                ? annotationCompanion(first) === moduleName
                : first.kind === "TypeVariable" && first.name === subject)
            ? { dotCallable: true as const }
            : {}),
        },
      ]);
    };
    for (const [name, symbol] of prelude.terms) {
      // A **`widens` binding** is qualifiable, not a bare export (Constraints
      // §4.7, Modules §5.3): it inherits the visibility rule of the member it widens,
      // so it takes no bare-scope binding and counts for nothing in §5.5's
      // collision arithmetic — bare `pow` still has exactly one exporter,
      // `Pow.hex`'s member, however many companions widen their `pow`. Every
      // other registration below it keeps, because those are the routes it does
      // own: `#preludeTermsByName` is the *dot-call* channel and nothing else
      // (`#noteCompanionCandidate`), and the last three are what let the
      // qualified spelling resolve and its import be synthesized.
      //
      // §5.5's channels decide the rest. An **open union's** constructor and an
      // **exception** constructor are bare; a **pervasive term** is bare; every
      // other export takes a route instead of a binding, and a `widens` binding
      // takes neither — it is not an exporter at all, so naming it as a route
      // would offer `Float.pow` where §10's member row says the declaring
      // module.
      const constructor = openConstructors.has(name) || qualifiedOnlyConstructors.has(name);
      const bare = openConstructors.has(name) || exceptionConstructors.has(name) ||
        (!constructor && pervasive(name));
      if (prelude.widensBindings.has(name)) {
        // nothing: neither a bare binding nor a route.
      } else if (!bare) {
        route(name, constructor ? "constructor" : "function");
      } else {
        this.#preludeScope.define(name, symbol.id);
        // The home a refused bare reference is rewritten to. `moduleName` is the
        // same string `#preludeModuleAliases` was keyed by just above, so the
        // diagnostic's suggestion is a spelling that resolves rather than a guess
        // at one; the specifier stands in only if a member has no basename to be
        // named by, which no injection path produces.
        this.#preludeHomesByName.set(name, [
          ...this.#preludeHomesByName.get(name) ?? [],
          moduleName === "" ? specifier : moduleName,
        ]);
      }
      this.#preludeTermsByName.set(name, [
        ...this.#preludeTermsByName.get(name) ?? [],
        symbol.id,
      ]);
      this.#preludeTerms.set(symbol.id, symbol);
      this.#preludeSpecifierBySymbol.set(symbol.id, specifier);
      // Registered eagerly so `#symbol` resolves prelude references during body
      // resolution; unused entries never reach emission (the import lists only
      // the terms actually referenced) and are excluded from id-base progression.
      this.#importedSymbols.set(symbol.id, symbol);
    }
    // A constraint member is an export of its declaring module (#335), so the
    // members seed exactly as the terms above do — same fallback scope, same
    // collision arithmetic, same synthesized-import channel — under §5.5's
    // member rule, which admits `Show.show` and nothing else (#742). Every other
    // member takes a route: the dot where it is subject-first, the declaring
    // module always.
    //
    // `constraintMembers` holds only the members of constraints this module
    // *declares* (see `ModuleInterface`), never the member bindings of an
    // `honor` block, which is the boundary the note's §5 item 8 requires: bare
    // `show` in a consumer has exactly one exporter, `Show.hex` — an honoring
    // module's binding is reached only qualified, or bare from inside that
    // module.
    const subjects = new Map<string, string>();
    /** Members of a structurally-instanced constraint, by spelling (see `PreludeRoute`). */
    const structuralMembers = new Set<string>();
    // The bare member is the one its *declaration's identity* names (§5.5), so
    // the seat is collected here, off the declarations this module exports,
    // rather than tested against the member's spelling below.
    const pervasiveMembers = new Set<string>();
    for (const declaration of prelude.constraints.values()) {
      if (PERVASIVE_PRELUDE_MEMBERS.get(declaration.identity) !== undefined) {
        pervasiveMembers.add(PERVASIVE_PRELUDE_MEMBERS.get(declaration.identity)!);
      }
      for (const member of declaration.members) {
        subjects.set(member.binding.name, declaration.subject);
        if (STRUCTURAL_CONSTRAINT_IDENTITIES.has(declaration.identity)) {
          structuralMembers.add(member.binding.name);
        }
        if (!parametersByName.has(member.binding.name)) {
          parametersByName.set(member.binding.name, member.parameters);
        }
      }
    }
    for (const [name, symbol] of prelude.constraintMembers) {
      if (pervasiveMembers.has(name)) {
        this.#preludeScope.define(name, symbol.id);
        this.#preludeHomesByName.set(name, [
          ...this.#preludeHomesByName.get(name) ?? [],
          moduleName === "" ? specifier : moduleName,
        ]);
      } else {
        route(name, "member", subjects.get(name));
        this.#preludeMembersByName.set(name, symbol.id);
      }
      this.#preludeTermsByName.set(name, [
        ...this.#preludeTermsByName.get(name) ?? [],
        symbol.id,
      ]);
      this.#preludeTerms.set(symbol.id, symbol);
      this.#preludeSpecifierBySymbol.set(symbol.id, specifier);
      this.#importedSymbols.set(symbol.id, symbol);
    }
    // The declarations themselves ride the metadata channel, so the checker
    // validates an `honor` against the source declaration rather than its
    // wired-in fallback table. Metadata only, never scope — a consumer's binder
    // `<a: Show>` still resolves through pre-registration, and nothing here
    // makes a prelude constraint importable severally.
    for (const declaration of prelude.visibleConstraints) {
      if (!this.#visibleConstraints.has(declaration.identity)) {
        this.#visibleConstraints.set(declaration.identity, declaration);
      }
    }
    // The exception declarations behind the constructor names just seeded — the
    // `visibleConstraints` channel one line up, for the other declaration form
    // whose *terms* cross while its shape stays behind (#469). A prelude
    // exception is reachable in a catch arm bare, and — §6.4's qualified home
    // being what `moduleName` above registered — as `Map.KeyError` too; the
    // checker needs the declaration to answer for either spelling.
    for (const declaration of prelude.exceptions.values()) {
      this.#visibleExceptions.set(declaration.binding.symbol, declaration);
    }
    for (const [name, union] of prelude.unions) {
      seedTypeName(name);
      // Kept separately from `#unionNames` for the reason given below for
      // records: a local declaration may occlude the name (§5.4), and the
      // compiler's own producers must still reach the prelude's `Bool`.
      this.#preludeUnions.set(name, union.id);
      this.#unionNames.set(name, union.id);
      this.#unionArities.set(name, union.parameters.length);
      inventory(name, { union: union.id });
      if (!this.#unions.some(({ id }) => id === union.id)) {
        this.#unions.push({ ...union, representationVisible: false });
      }
    }
    for (const [name, record] of prelude.records) {
      seedTypeName(name);
      // Kept separately from `#recordNames`, which a local declaration may
      // occlude (§5.4). The compiler's own producers must reach the *prelude's*
      // `Seq`, not whatever record a module happens to name `Seq`, so they need
      // an identity that occlusion cannot move.
      this.#preludeRecords.set(name, record.id);
      this.#recordNames.set(name, record.id);
      this.#recordArities.set(name, record.parameters.length);
      inventory(name, { record: record.id });
      if (!this.#records.some(({ id }) => id === record.id)) {
        this.#records.push({ ...record, representationVisible: false });
      }
    }
    // Aliases are seeded but never inventoried: a face carries an alias's
    // expansion rather than its name (§2.4, Modules §11.4), so no `.d.ts` can
    // reference one and an entry could only ever produce a dead import.
    for (const [name, alias] of prelude.aliases) {
      seedTypeName(name);
      this.#typeAliases.set(name, { ...alias, name });
    }
    for (const [name, externType] of prelude.externTypes) {
      seedTypeName(name);
      this.#externTypeNames.set(name, externType.externType);
      inventory(name, { externType: externType.externType });
      if (!this.#externTypes.some(({ externType: id }) => id === externType.externType)) {
        this.#externTypes.push({ ...externType, localName: name });
      }
    }
  }

  resolve(module: Parsed.Module): Resolved.Module {
    this.#fileId = Number(module.fileId);
    this.#moduleFileId = module.fileId;
    this.#predeclareTypes(module.items);
    // Implied type names have owner-relative identity, but failed uses outside
    // an owner still receive the knowing v1 diagnostic even before declaration.
    // See Collections Part 2 §6–§7.3.
    for (const item of module.items) {
      if (item.kind !== "ConstraintDeclaration") continue;
      this.#declaredConstraintNames.add(item.name.text);
      for (const impliedType of item.impliedTypes) {
        const owners = this.#impliedTypeOwners.get(impliedType.name.text) ?? new Set();
        owners.add(item.name.text);
        this.#impliedTypeOwners.set(impliedType.name.text, owners);
      }
    }
    // After both, and before any item: an import's type-namespace half is
    // order-insensitive (Modules §3), and the names it must lose a collision to
    // are the module's own — the declarations above and the constraint names
    // just collected.
    this.#predeclareImports(module.items);
    // The prelude layer was seeded before there was a module to measure, so it
    // is given its region now. It governs the whole file — that is what
    // "implicitly in scope everywhere" means — and it is registered first, so
    // that a module-level binding of the same name, recorded later, is the one
    // an inner-wins reader takes.
    this.#preludeScope.region = module.span;
    this.#openScopes.push(this.#preludeScope);
    const scope = this.#openScope(this.#preludeScope, module.span, true);
    // The one scope whose parent is the prelude layer, and so the only one where
    // Modules §5.4 permits occlusion. Held rather than inferred: "module level"
    // is scope identity, not nesting depth — a block body of a module-level
    // `let` runs at lambda depth 0 but is an inner layer, where the ban is
    // absolute.
    this.#moduleScope = scope;
    this.#predeclareExternTerms(module.items, scope);
    this.#indexHonoredMemberLines(module.items);
    this.#seedHonoredMemberSpellings();
    const walked = this.#resolveItems(module.items, scope);
    this.#claimHonoredMembers(walked, scope);
    // After the claim and before everything downstream: the members a `widens`
    // declaration supplies are derived here, so member seats, emission, and the
    // checker all meet a block whose manifest is complete (Constraints §4.7).
    const resolvedItems = this.#supplyWidenedMembers(walked);
    // After resolution, never before: the synthesized import's local names have
    // to dodge every name the emitted module binds, and that set is only closed
    // once every declaration has been through `#declare` (PR #91 finding F1).
    const preludeChannel = this.#preludeInstanceChannel(module.span);
    // Dictionary Sharing §5's naming pass, last of all: it needs every declared
    // instance and every imported one in one place, and both channels are only
    // complete here.
    const { items, preludeInstances } = nameDictionaries(
      this.#assignMemberSeats([
        ...this.#preludeImport(module.span, resolvedItems),
        ...resolvedItems,
      ]),
      preludeChannel,
    );

    return {
      kind: "Module",
      fileId: module.fileId,
      items,
      symbols: [...this.#importedSymbols.values(), ...this.#symbols.values()],
      scopes: this.#openScopes.map((open) => ({
        // Every registered scope has been given a region; the module's own span
        // is the only sensible answer if one somehow was not, and is wide rather
        // than wrong.
        span: open.region ?? module.span,
        bindings: open.recorded,
        body: open.body,
      })),
      // Explicit aliases first, so a reader taking the first entry for a name
      // gets the one that wins: an `import Vector` is a module-level
      // binding and outranks the prelude companion of the same name (§5.4).
      moduleAliases: [...this.#moduleAliases, ...this.#preludeModuleAliases]
        .map(([alias, reached]) => ({
          alias,
          members: [...reached.terms].map(([name, symbol]) => ({ name, symbol: symbol.id })),
        })),
      unions: this.#unions,
      records: this.#records,
      preludeRecords: this.#preludeRecords,
      preludeUnions: this.#preludeUnions,
      preludeInstances,
      // Read after resolution, never during: `explicitLocal` records that a
      // source-written import took an entry over (§2.4), and the import items
      // are only all resolved by now.
      preludeTypeImports: this.#preludeTypeImports.map((entry) => ({ ...entry })),
      visibleConstraints: [...this.#visibleConstraints.values()],
      visibleExceptions: [...this.#visibleExceptions.values()],
      externTypes: this.#externTypes,
      comments: module.comments,
      docs: module.docs,
      ...(this.#companionPrimitive === undefined
        ? {}
        : { companionPrimitive: this.#companionPrimitive }),
      ...(this.#path === undefined ? {} : { path: this.#path }),
      span: module.span,
      diagnostics: this.#diagnostics.toArray(),
    };
  }

  /**
   * Opens a scope and registers it for `Module.scopes`.
   *
   * `region` is the source the scope actually governs, which is not always the
   * span of the construct that opened it — see the `For` case, where the
   * iterable is resolved outside the scope its own pattern binds into.
   */
  #openScope(parent: Scope, region: Source.Span, body = false): Scope {
    const scope = new Scope(parent, region, body);
    this.#openScopes.push(scope);
    return scope;
  }

  /** Registers module type identities before resolving any declaration body. */
  #predeclareTypes(items: readonly Parsed.Item[]): void {
    const claimed = new Map<string, Source.Span>();
    const declarations: (
      | Parsed.TypeAliasItem
      | Parsed.UnionItem
      | Parsed.RecordItem
      | Parsed.ExternTypeDeclaration
    )[] = [];
    for (const item of items) {
      if (item.kind === "TypeAlias" || item.kind === "Union" || item.kind === "RecordDeclaration") {
        declarations.push(item);
      } else if (item.kind === "ExternBlock") {
        declarations.push(...item.declarations.filter(
          (declaration): declaration is Parsed.ExternTypeDeclaration =>
            declaration.kind === "ExternType",
        ));
      }
    }
    for (const item of declarations) {
      const itemName = item.kind === "ExternType" ? item.localName : item.name;
      const previous = claimed.get(itemName.text);
      if (previous !== undefined) {
        this.#diagnostics.add({
          severity: "error",
          message: `type \`${itemName.text}\` is already declared`,
          primary: itemName.span,
          labels: [{ span: previous, message: "first declaration is here" }],
        });
        continue;
      }
      claimed.set(itemName.text, itemName.span);
      if (item.kind === "TypeAlias") {
        this.#typeAliases.set(item.name.text, item);
      } else if (item.kind === "Union") {
        const id = Resolved.unionId(this.#nextUnion++);
        this.#unionDeclarations.set(item, id);
        this.#unionNames.set(item.name.text, id);
        this.#unionArities.set(item.name.text, item.parameters.length);
      } else if (item.kind === "RecordDeclaration") {
        const id = Resolved.recordId(this.#nextRecord++);
        this.#recordDeclarations.set(item, id);
        this.#recordNames.set(item.name.text, id);
        this.#recordArities.set(item.name.text, item.parameters.length);
      } else {
        const id = Resolved.externTypeId(this.#nextExternType++);
        this.#externTypeDeclarations.set(item, id);
        this.#externTypeNames.set(item.localName.text, id);
      }
    }
  }

  /**
   * Binds every import item's **type-namespace** half, before any item is walked.
   *
   * Modules §3: an import straddles the reading laws exactly as the declaration
   * it imports does. The types it binds, the constraint names, and the module
   * alias in type position are order-insensitive — a *declaration's* policy
   * (Preamble §7.2) — so they can no more wait for the walk to reach the line
   * than a `record`'s name can wait for its item; `#predeclareTypes` is this
   * pass's twin for the module's own declarations. The **term** half stays at
   * the item, where the top-down law puts it, and so does everything that is
   * neither: the missing-export reports, the emission inventories, the instance
   * channel, the members a constraint brings.
   *
   * Runs after `#predeclareTypes` and after the module's own constraint names
   * are known, so the "already declared or imported" contest reads as it always
   * has — the module's own declarations claim first, imports settle among
   * themselves in source order — and lands on the same line it landed on before.
   */
  #predeclareImports(items: readonly Parsed.Item[]): void {
    for (const item of items) {
      if (item.kind !== "Import") continue;
      const imported = this.#imports.get(item.specifier);
      // An unresolvable specifier binds nothing, and the item reports it once.
      if (imported === undefined) continue;
      const constraints: Resolved.ConstraintImport[] = [];
      let aliasBound = false;
      if (this.#moduleAliases.has(item.alias.text)) {
        this.#diagnostics.add({
          severity: "error",
          message: `module alias \`${item.alias.text}\` is already bound`,
          primary: item.alias.span,
        });
      } else {
        aliasBound = true;
        this.#moduleAliases.set(item.alias.text, imported);
        this.#moduleAliasSpecifiers.set(item.alias.text, item.specifier);
        // Bound but not yet *reached*: the alias's term-position doors
        // (`Lib.area`, `Lib.Circle`) stay shut until the walk passes the item.
        this.#pendingImportAliases.set(item.alias.text, item.alias);
        // §3.1: a constraint qualifies through the alias in a binder
        // (`<a: Geo.C>`), and its members through it as ordinary terms
        // (`Geo.describe(x)`). The alias is the module in both cases — but
        // only the binder is type position, so only it is free of the line.
        for (const declaration of imported.constraints.values()) {
          const local = `${item.alias.text}.${declaration.name}`;
          this.#qualifiedConstraints.set(local, declaration);
          constraints.push({ local, declaration });
        }
      }
      this.#importTypeBindings.set(item, { constraints, aliasBound });
    }
    this.#registerCompanionConstraints(items);
  }

  /**
   * Modules §5.1 rule 2's **companion fallback**, constraint half — "every
   * property above holding one namespace over".
   *
   * A bare `Name` in constraint position that the constraint namespace has
   * nothing for resolves to the constraint `Name` exported by a visible module
   * alias `Name`: a binder's list and an `honor` head alike, wherever the bare
   * spelling is read. There is no compiler-owned constraint analogue of the
   * boundary types to order against — the eleven pre-registered names are simply
   * always present (Constraints §5.1.1), so the fallback never reaches them.
   *
   * Run **after** every import has predeclared, which is what makes "answers,
   * never binds" mechanical rather than a promise: the bare name is registered
   * only when nothing else in the constraint namespace has claimed it — not the
   * module's own declaration, not pre-registration — so no collision check
   * exists for it to fail and nothing downstream ever sees two meanings for
   * the word.
   *
   * The fallback carries **no members**: the entry is the constraint's *name*
   * and nothing else, exactly as the qualified `Alias.Name` entry beside it is.
   * Members are reached through the alias or by the dot (§3.2, #762).
   */
  #registerCompanionConstraints(items: readonly Parsed.Item[]): void {
    for (const item of items) {
      if (item.kind !== "Import") continue;
      const alias = item.alias.text;
      const bound = this.#importTypeBindings.get(item);
      // A duplicate alias spelling bound nothing, so it reaches nothing either.
      if (bound === undefined || !bound.aliasBound) continue;
      if (
        isPreRegisteredConstraint(alias) ||
        this.#declaredConstraintNames.has(alias) ||
        this.#companionConstraints.has(alias)
      ) {
        continue;
      }
      const declaration = this.#imports.get(item.specifier)?.constraints.get(alias);
      if (declaration === undefined) continue;
      this.#companionConstraints.set(alias, declaration);
      this.#importTypeBindings.set(item, {
        ...bound,
        constraints: [...bound.constraints, { local: alias, declaration }],
      });
    }
  }


  #predeclareExternTerms(items: readonly Parsed.Item[], scope: Scope): void {
    for (const item of items) {
      if (item.kind !== "ExternBlock") continue;
      const kind = externBindingKind(item.specifier);
      for (const declaration of item.declarations) {
        if (declaration.kind === "ExternType") continue;
        const existing = scope.lookupLocal(declaration.localName.text);
        if (existing !== undefined) this.#reportRebinding(declaration.localName, existing);
        const binding = this.#declare(declaration.localName, kind);
        this.#predeclaredBindings.set(declaration, binding);
        if (existing === undefined) scope.define(declaration.localName.text, binding.symbol);
      }
    }
  }

  /**
   * The gate (`spec/intrinsics.md` §5). Returns whether this block is the
   * intrinsic door — which it is only when the specifier names it *and* the
   * module may use it. In unprivileged source the block never resolves, so no
   * user program can reach the inventory (§5.3), and reporting exactly one error
   * per block keeps the diagnostic about the thing the author actually typed.
   */
  #checkExternSpecifier(
    specifier: string,
    span: Source.Span,
    form: "block" | "import",
  ): boolean {
    if (!isIntrinsicScheme(specifier)) return false;
    if (!this.#privileged) {
      // The rewrite names the form the author was already writing. Pointing an
      // effect import at an `extern from` block would be telling them to rewrite
      // the wrong half of what they typed.
      this.#diagnostics.add({
        severity: "error",
        message: "the `hex:` specifier scheme is reserved to standard-library source; " +
          (form === "block"
            ? "to bind your own JavaScript implementation, use an ordinary `extern from` " +
              "block naming your module"
            : "to run your own JavaScript module for its effects, use an ordinary " +
              "`extern import` naming your module"),
        primary: span,
      });
      return false;
    }
    if (specifier !== INTRINSIC_SPECIFIER) {
      this.#diagnostics.add({
        severity: "error",
        message: `\`${specifier}\` is not a reserved boundary; ` +
          `\`${INTRINSIC_SPECIFIER}\` is the scheme's only member`,
        primary: span,
      });
      return false;
    }
    return true;
  }

  /**
   * Verification replaces trust (§4.2). At a foreign boundary the declaration is
   * believed; here the compiler is the implementer, so key existence and arity
   * are checked at the declaration site. Types are deliberately *not* checked
   * against a compiler-side table — the annotation is normative, and a lowering
   * that diverges from it is a compiler conformance defect, never a user
   * diagnostic.
   */
  #verifyIntrinsicKey(
    declaration: Parsed.ExternFunDeclaration | Parsed.ExternLetDeclaration,
  ): void {
    // A `default` declaration has no foreign name to be the key, and the form
    // was already refused (§3.3). Verifying the local name as a key on top of
    // that would report the author's one mistake twice, the second time as a
    // claim about a key they never wrote.
    if (declaration.default) return;
    const name = declaration.foreignName ?? declaration.localName;
    const arity = INTRINSIC_INVENTORY.get(name.text);
    if (arity === undefined) {
      // The Rewrite Rule wants a named rewrite in every hard error. A near
      // neighbour is the best one — it is almost always the key the author meant.
      // With nothing close, the inventory itself is the rewrite: it is flat and
      // compiler-global, so listing it is exhaustive rather than a guess, which
      // is the one thing a suggestion here must not be.
      const nearest = nearestIntrinsicKey(name.text);
      this.#diagnostics.add({
        severity: "error",
        message: `the compiler provides no intrinsic \`${name.text}\`; ` +
          (nearest === undefined
            ? `the keys it provides are ${[...INTRINSIC_INVENTORY.keys()]
              .map((key) => `\`${key}\``).join(", ")}`
            : `the nearest provided key is \`${nearest}\``),
        primary: name.span,
      });
      return;
    }
    if (declaration.kind !== "ExternFun") return;
    if (declaration.parameters.length !== arity) {
      this.#diagnostics.add({
        severity: "error",
        message: `intrinsic \`${name.text}\` takes ${arity} ` +
          `${arity === 1 ? "parameter" : "parameters"}, but this declaration has ` +
          `${declaration.parameters.length}`,
        primary: declaration.span,
      });
    }
  }

  #resolveItems(
    items: readonly Parsed.Item[],
    scope: Scope,
  ): readonly Resolved.Item[] {
    // Everything the block declares, so a reference that finds nothing in scope
    // can be told it is reading a declaration that has not happened yet
    // (Functions §7.2/§10) instead of being told the name is unknown. Entries
    // leave as the walk passes their declaration, so what remains is exactly
    // what is still *later* than the reference being resolved.
    const frame: BlockDeclarations = {
      later: new Map(),
      funSymbols: new Set(),
      reserved: new Set(),
    };
    const declare = (later: LaterDeclaration): void => {
      if (!frame.later.has(later.name.text)) frame.later.set(later.name.text, later);
    };
    // Modules §5.4's reservation, claimed by the forms that may take a prelude
    // name over: the four sequential binders (Statements §5.1's exemption), a
    // constraint's members, which bind at module level the way a `let` does, an
    // import's locals, which §5.4 lists beside them, and — since #466 — a
    // declaration's **constructor names**, a union's, a record's, or an
    // exception's. A name one of the module's *own* layers already binds is a
    // rule-1 collision rather than an occlusion, and reserves nothing — the
    // lookup below is what tells the two apart, and it runs before any item of
    // this block is walked, so the block's own later declarations cannot answer
    // it.
    const reserve = (name: string): void => {
      if (scope.lookupOwner(name) === this.#preludeScope) frame.reserved.add(name);
    };
    for (const item of items) {
      if (item.kind === "Fun" || item.kind === "Let" || item.kind === "Var") {
        declare({ name: item.name, fun: item.kind === "Fun" });
        reserve(item.name.text);
      } else if (item.kind === "LetPattern") {
        for (const name of Parsed.patternNames(item.pattern)) {
          declare({ name, fun: false });
          reserve(name.text);
        }
      } else if (item.kind === "Import") {
        // Modules §3 (#762): an import binds a module and nothing smaller, so
        // it puts no *bare* name in this frame at all — nothing to declare,
        // and nothing to reserve against the prelude layer. Its module alias
        // is the whole of what it binds: order-insensitive in type and
        // constraint position (`#predeclareImports` binds it before any item
        // is walked) and top-down in term position, where
        // `#pendingImportAliases` carries it. §5.4 still names the import
        // among the prelude's occluders — an alias may occlude a prelude
        // module's alias — and that contest is the alias namespace's, run at
        // predeclaration and not in this frame.
      } else {
        // The term names a type-namespace declaration binds. Their references
        // read top-down like any other term reference (§7.2); the declarations
        // themselves, and every type-position mention of them, stay order-free.
        //
        // Every one of them reserves (#466). Constructor names joined the
        // occlusion grant with the constraint members that were already here, so
        // the reservation follows them — and it is what carries the grant into
        // **pattern** position, which §5.4 reads as one scope with value
        // position: `#resolvePattern` consults `#lookupTerm` like every other
        // reference, so a bare constructor pattern above the declaration draws
        // §7.2's declared-later error rather than the prelude's constructor.
        for (const { name, owner } of termNamesBound(item)) {
          declare({ name, fun: false, owner });
          reserve(name.text);
        }
      }
    }
    this.#blockDeclarations.push(frame);
    const resolved: Resolved.Item[] = [];
    for (let index = 0; index < items.length; index += 1) {
      const item = items[index];
      if (item === undefined) continue;
      // *(#700.)* A `fun` **block** is one group (Functions §7.3): every member
      // is bound before the first body is walked, so the bodies see each other
      // in both directions. Adjacency is no longer load-bearing — two blocks
      // written back to back are two heads, and a fused `fun` is the one-member
      // block — so the boundary is the head's identity and nothing else.
      if (item.kind === "Fun" && !this.#predeclaredBindings.has(item)) {
        for (let scan = index; scan < items.length; scan += 1) {
          const member = items[scan];
          if (member?.kind !== "Fun") break;
          // A fused `fun` carries no head, so it is a group of one; a member of
          // *another* block carries another head, and stops this one.
          if (
            scan !== index &&
            (item.block === undefined || member.block?.id !== item.block.id)
          ) {
            break;
          }
          // Rule 1, layered by Modules §5.4 exactly as the `Let` case below:
          // a module-level `fun` may occlude a prelude name, so the lookup
          // stops at the module's own layer there; in a block it walks out
          // through every layer the module wrote — the ban is absolute over
          // those (#456; the conformance defect log carries the record) — and
          // past the prelude, which `#lookupTerm` has already reserved for this
          // `fun`, so the shadow is granted rather than reported.
          const existing = scope === this.#moduleScope
            ? scope.lookupLocal(member.name.text)
            : this.#lookupTerm(member.name.text, scope);
          const pendingHit = this.#reportPendingRebinding(member.name, existing, scope);
          if (!pendingHit && existing !== undefined) {
            this.#reportRebinding(member.name, existing);
          }
          const binding = this.#declare(member.name, "fun");
          this.#predeclaredBindings.set(member, binding);
          frame.funSymbols.add(binding.symbol);
          frame.later.delete(member.name.text);
          if (existing === undefined || pendingHit) {
            scope.define(member.name.text, binding.symbol, item.span.start.offset);
          }
        }
      }
      const resolvedItem = this.#resolveItem(item, scope);
      resolved.push(resolvedItem, ...this.#derivedHonors(resolvedItem));
      if (item.kind === "Fun" || item.kind === "Let" || item.kind === "Var") {
        frame.later.delete(item.name.text);
      } else if (item.kind === "LetPattern") {
        for (const name of Parsed.patternNames(item.pattern)) frame.later.delete(name.text);
      } else if (item.kind === "Import") {
        // The alias's **term** half arrives here, and only here: `Lib.area`
        // and `Lib.Circle` are locals this line binds (Modules §3.1), so they
        // read top-down while `Lib.Point` in an annotation does not. The alias
        // itself was registered before the walk, for the type half's sake, so
        // the term door is gated on this set instead of on registration.
        //
        // An import puts no *bare* name in scope (§3, #762), so there is
        // nothing for the block frame's `later` set to forget: the alias is
        // the whole of what the line binds, and `#pendingImportAliases`
        // carries its top-down half.
        this.#pendingImportAliases.delete(item.alias.text);
      } else {
        for (const { name } of termNamesBound(item)) frame.later.delete(name.text);
      }
    }
    this.#blockDeclarations.pop();
    return resolved;
  }


  /** Expands declaration-header derivation sugar into ordinary instance items. */
  #derivedHonors(item: Resolved.Item): readonly Resolved.HonorItem[] {
    if (item.kind !== "Union" && item.kind !== "RecordDeclaration") return [];
    const requiredParameters = new Set(
      (item.kind === "Union"
        ? item.constructors.flatMap((constructor) => constructor.slots)
        : item.fields
      ).flatMap(({ annotation }) => annotationTypeVariables(annotation)),
    );
    const subject: Resolved.TypeAnnotation = item.kind === "Union"
      ? {
          kind: "Union",
          union: item.union,
          name: item.name,
          arguments: item.parameters.map((name) => ({
            kind: "TypeVariable",
            name,
            span: item.span,
          })),
          span: item.span,
        }
      : {
          kind: "RecordDeclaration",
          record: item.record,
          name: item.name,
          arguments: item.parameters.map((name) => ({
            kind: "TypeVariable",
            name,
            span: item.span,
          })),
          span: item.span,
        };
    return item.derives.map((constraint) => ({
      kind: "Honor",
      constraint,
      constraintIdentity: this.#constraintIdentity(constraint),
      typeParameters: item.parameters.map((name) => ({
        name,
        constraints: requiredParameters.has(name) ? [constraint] : [],
        ...(requiredParameters.has(name)
          ? { constraintIdentities: [this.#constraintIdentity(constraint)] }
          : {}),
        span: item.span,
      })),
      subject,
      derived: true,
      // The constraint's *declared* name, exactly as the `honor` arm spells it
      // (#727): `derives (H)` under `import { Hash as H }` is the pre-registered
      // `Hash` reached by an importer's word, and the dictionary it emits is
      // `__Hash_P` — the same binding the canonical spelling of the same program
      // emits, since a spelling is not a property of a constraint at a border.
      dictionary: dictionaryName(
        this.#namedConstraint(constraint)?.name ?? constraint,
        item.name,
      ),
      memberSeats: [],
      impliedTypes: [],
      members: [],
      span: item.span,
    }));
  }

  #resolveItem(item: Parsed.Item, scope: Scope): Resolved.Item {
    switch (item.kind) {
      case "Import": {
        if (!item.specifier.startsWith("./") && !item.specifier.startsWith("../")) {
          this.#diagnostics.add({
            severity: "error",
            message: "package imports are not yet supported; use a relative module path",
            primary: item.span,
          });
        }
        const importedModule = this.#imports.get(item.specifier);
        if (importedModule === undefined) {
          this.#diagnostics.add({
            severity: "error",
            message: `cannot resolve module \`${item.specifier}\``,
            primary: item.span,
          });
        }
        /**
         * What this line put in the constraint namespace; see
         * `ConstraintImport`. A constraint *name* is type-namespace, so the
         * binding itself happened before the walk (`#predeclareImports`) and
         * this is a read of what it decided — including which entries lost a
         * collision and bound nothing.
         */
        const typeHalf = this.#importTypeBindings.get(item);
        const boundConstraints: readonly Resolved.ConstraintImport[] =
          typeHalf?.constraints ?? [];
        // Metadata before names, and for every import form including the effect
        // one: what a module can *see* of the constraint graph is a property of
        // the graph, not of what this line chose to bind (Modules §6.5). The
        // declarations that only arrive here are the ones no import could name —
        // a private middle link in a base chain; see `Module.visibleConstraints`.
        for (const declaration of importedModule?.visibleConstraints ?? []) {
          if (!this.#visibleConstraints.has(declaration.identity)) {
            this.#visibleConstraints.set(declaration.identity, declaration);
          }
        }
        // The imported module's exception declarations, on the same terms and
        // for every import form (#469). Metadata, not a binding: whether this
        // line puts `Boom` in bare scope, reaches it as `Lib.Boom`, or neither,
        // is decided by the halves below — this only lets the checker recognise
        // the constructor symbol whichever spelling arrives.
        for (const declaration of importedModule?.exceptions.values() ?? []) {
          this.#visibleExceptions.set(declaration.binding.symbol, declaration);
        }
        // The alias and its qualified constraints bound before the walk; what is
        // left here is the emission inventory, which is a table this module
        // publishes rather than a name anything resolves through — so it is
        // gathered where every other item gathers its own, in source order.
        if (typeHalf?.aliasBound === true && importedModule !== undefined) {
          this.#includeNominals(importedModule, item.alias.text);
          for (const symbol of importedModule.terms.values()) {
            this.#importedSymbols.set(symbol.id, symbol);
          }
          for (const symbol of importedModule.constraintMembers.values()) {
            this.#importedSymbols.set(symbol.id, symbol);
          }
        }
        const namespaceAlias = item.alias.text;
        // An explicit import of a *prelude* module carries no instance evidence
        // (#263), for the reason `#preludeImport` carries none (#153): the
        // prelude's instances ride `Module.preludeInstances`, which every module
        // gets whether or not it imports anything. Carrying them here as well
        // would put a second copy of the same identity into this module's
        // interface, which consumers would then predict imports of and
        // intermediates re-export — the transit #153 cut for the synthesized
        // channel, cut here for the explicit one.
        //
        // Only prelude modules. An ordinary module's `honor` is reachable from a
        // consumer three hops away *only* through the intermediates, so instance
        // evidence on a non-prelude import is load-bearing and untouched.
        const preludeSource = importedModule !== undefined &&
          this.#preludeFileIds.has(Number(importedModule.module.fileId));
        return {
          kind: "Import",
          specifier: item.specifier,
          synthesized: false,
          form: {
            kind: "Namespace",
            alias: namespaceAlias,
            names: [
              ...[...(importedModule?.terms.entries() ?? [])].map(
                ([name, symbol]) => ({ name, symbol, member: false }),
              ),
              // §3.1: `Geo.describe(x)` is an ordinary term reference,
              // reached through the alias like any other export.
              ...[...(importedModule?.constraintMembers.entries() ?? [])].map(
                ([name, symbol]) => ({ name, symbol, member: true }),
              ),
            ].map(({ name, symbol, member }) => ({
              imported: name,
              local: `${namespaceAlias}.${name}`,
              symbol: symbol.id,
              ...(member ? { constraintMember: true } : {}),
              span: item.span,
            })),
          },
          instances: (preludeSource ? [] : importedModule?.instances ?? []).map((instance) => ({
            identity: instance.identity,
            constraint: instance.constraint,
            constraintIdentity: instance.constraintIdentity,
            typeParameters: instance.typeParameters,
            subject: instance.subject,
            impliedTypes: instance.impliedTypes,
            importedDictionary: instance.dictionary,
            // The exporter's interface name, unaliased. `nameDictionaries`
            // suffixes it later if this module contests the spelling (§5).
            localDictionary: instance.dictionary,
            derived: instance.derived,
            memberSeats: instance.memberSeats,
            ...this.#seatOrigin(instance.declaringPath),
            span: item.span,
          })),
          constraints: boundConstraints,
          internalNames: internalNameInputs(importedModule),
          specializableTerms: specializableTerms(importedModule),
          span: item.span,
        };
      }
      case "ExternImport":
        // The reservation is a property of the scheme, not of one block form, so
        // it fails closed here too. In privileged source the specifier is legal
        // but the form is not: §8.3 emits no import because there is no foreign
        // module, and an effect import of the door would emit one that resolves
        // to nothing.
        if (this.#checkExternSpecifier(item.specifier, item.span, "import")) {
          this.#diagnostics.add({
            severity: "error",
            message: "the intrinsic door has no foreign module to import; " +
              "declare the operations you need in an `extern from " +
              `${JSON.stringify(INTRINSIC_SPECIFIER)}\` block`,
            primary: item.span,
          });
        }
        return item;
      case "ExternBlock": {
        const intrinsic = this.#checkExternSpecifier(item.specifier, item.span, "block");
        const declarations = item.declarations.map((declaration): Resolved.ExternDeclaration => {
          if (intrinsic && declaration.kind !== "ExternType") {
            this.#verifyIntrinsicKey(declaration);
          }
          if (declaration.kind === "ExternType") {
            const resolved: Resolved.ExternTypeDeclaration = {
              kind: "ExternType",
              exported: declaration.exported,
              default: false,
              ...(declaration.pure === undefined ? {} : { pure: declaration.pure }),
              ...(declaration.foreignName === undefined ? {} : { foreignName: declaration.foreignName.text }),
              localName: declaration.localName.text,
              externType: this.#externTypeDeclarations.get(declaration) ?? Resolved.externTypeId(this.#nextExternType++),
              span: declaration.span,
            };
            this.#externTypes.push(resolved);
            return resolved;
          }
          const binding = this.#predeclaredBindings.get(declaration) ??
            this.#declare(declaration.localName, externBindingKind(item.specifier));
          const common = {
            exported: declaration.exported,
            default: declaration.default,
            ...(declaration.pure === undefined ? {} : { pure: declaration.pure }),
            ...(declaration.conduit === undefined ? {} : { conduit: declaration.conduit }),
            ...(declaration.foreignName === undefined ? {} : { foreignName: declaration.foreignName.text }),
            localName: declaration.localName.text,
            binding,
            span: declaration.span,
          };
          if (declaration.kind === "ExternLet") {
            return {
              kind: "ExternLet",
              ...common,
              annotation: this.#resolveTypeAnnotation(declaration.annotation),
            };
          }
          const parameters = declaration.parameters.map((parameter) => ({
            ...this.#declare(parameter.name, "parameter"),
            ...(parameter.annotation === undefined
              ? {}
              : { annotation: this.#resolveTypeAnnotation(parameter.annotation) }),
          }));
          return {
            kind: "ExternFun",
            ...common,
            // #370: an intrinsic row's constraint brackets ride the §3.4 grant.
            // The parser records them only inside the reserved boundary, so
            // nothing here has to re-derive the gate's answer.
            ...(declaration.typeParameters === undefined
              ? {}
              : {
                typeParameters: declaration.typeParameters.map((parameter) => ({
                  name: parameter.name.text,
                  constraints: parameter.constraints.map(({ text }) => text),
                  span: parameter.span,
                })),
              }),
            parameters,
            returnAnnotation: this.#resolveTypeAnnotation(declaration.returnAnnotation),
          };
        });
        return {
          kind: "ExternBlock",
          specifier: item.specifier,
          intrinsic,
          declarations,
          span: item.span,
        };
      }
      case "ConstraintDeclaration": {
        if (this.#constraintNames.has(item.name.text)) {
          this.#diagnostics.add({
            severity: "error",
            message: isPreRegisteredConstraint(item.name.text)
              ? `constraint \`${item.name.text}\` is pre-registered and cannot be redeclared`
              : `constraint \`${item.name.text}\` is already declared`,
            primary: item.name.span,
          });
        }
        this.#constraintNames.add(item.name.text);
        const typeParameters = new Set([item.subject.text]);
        const impliedTypes = new Set(item.impliedTypes.map(({ name }) => name.text));
        const impliedContext = { owner: item.name.text, names: impliedTypes };
        const memberBindings = item.members.map((member) => {
          // A constraint member binds at module level, so §5.4's occlusion rule
          // applies to it exactly as it does to `let` and `fun` (defect 9): it
          // may occlude a prelude name and may not collide with a sibling in its
          // own layer. Same scope-identity test, same reason — a depth test
          // would license shadowing in inner layers (PR #89 finding F1).
          const existing = scope === this.#moduleScope
            ? scope.lookupLocal(member.name.text)
            : scope.lookup(member.name.text);
          if (existing !== undefined) this.#reportRebinding(member.name, existing);
          const binding = this.#declare(member.name, "constraint-member");
          if (existing === undefined) scope.define(member.name.text, binding.symbol);
          return binding;
        });
        const members = item.members.map((member, index) => {
          const binding = memberBindings[index]!;
          const parameters = member.parameters.map((parameter) => ({
            ...this.#declare(parameter.name, "parameter"),
            ...(parameter.annotation === undefined
              ? {}
              : { annotation: this.#resolveTypeAnnotation(parameter.annotation, typeParameters, impliedContext) }),
          }));
          return {
            binding,
            parameters,
            returnAnnotation: this.#resolveTypeAnnotation(member.returnAnnotation, typeParameters, impliedContext),
            ...(member.defaultValue === undefined
              ? {}
              : { defaultValue: this.#resolveDefaultBody(member.defaultValue, scope, impliedContext) }),
            span: member.span,
          };
        });
        const declaration: Resolved.ConstraintItem = {
          kind: "ConstraintDeclaration",
          exported: item.exported,
          name: item.name.text,
          identity: this.#constraintIdentity(item.name.text),
          subject: item.subject.text,
          baseConstraints: item.baseConstraints.map(({ text }) => text),
          // Resolved here, where the names were written: an importer reading
          // `baseConstraints` alone could only guess (§6.5).
          baseConstraintIdentities: item.baseConstraints.map(({ text }) =>
            this.#constraintIdentity(text)
          ),
          // The declaring file, stamped here and carried onward untouched — the
          // orphan rule's "the module that declares `C`" (Constraints §5.3), and
          // what Modules §7.6's missing-instance report names
          // (`Resolved.ConstraintItem.declaringPath`).
          ...(this.#path === undefined ? {} : { declaringPath: this.#path }),
          impliedTypes: item.impliedTypes.map(({ name, span }) => ({
            name: name.text,
            span,
          })),
          members,
          span: item.span,
        };
        this.#visibleConstraints.set(declaration.identity, declaration);
        return declaration;
      }
      case "Honor": {
        const typeParameterNames = new Set(item.typeParameters.map(({ name }) => name.text));
        const subject = this.#resolveTypeAnnotation(item.subject, typeParameterNames);
        const declaration = this.#impliedTypeOwners;
        // An imported constraint's implied types come from its declaration —
        // the local owner table only knows this module's own (§6.5: the implied
        // type members do not travel separately, they *are* the declaration).
        const imported = this.#namedConstraint(item.constraint.text);
        const names = imported !== undefined
          ? new Set(imported.impliedTypes.map(({ name }) => name))
          : new Set(
              [...declaration.entries()]
                .filter(([, owners]) => owners.has(item.constraint.text))
                .map(([name]) => name),
            );
        const impliedContext = { owner: item.constraint.text, names };
        return {
          kind: "Honor",
          constraint: item.constraint.text,
          constraintIdentity: this.#constraintIdentity(item.constraint.text),
          typeParameters: item.typeParameters.map((parameter) => ({
            name: parameter.name.text,
            constraints: parameter.constraints.map(({ text }) => text),
            // Resolved here, where the head was written: a consumer of this
            // instance has no spelling for the constraint of its own (#762).
            constraintIdentities: parameter.constraints.map(({ text }) =>
              this.#constraintIdentity(text)
            ),
            span: parameter.span,
          })),
          subject,
          derived: item.derived,
          // The constraint's *declared* name, never the importer's spelling: an
          // alias or an `Alias.Name` qualification is this module's word for
          // someone else's declaration, and the second is not even a legal
          // JavaScript identifier.
          dictionary: dictionaryName(
            this.#namedConstraint(item.constraint.text)?.name ?? item.constraint.text,
            annotationHeadName(subject),
          ),
          // Filled by `#assignMemberSeats`, which runs once every declaration is
          // resolved and the constraint behind this head is in view.
          memberSeats: [],
          impliedTypes: item.impliedTypes.map((impliedType) => ({
            name: impliedType.name.text,
            annotation: this.#resolveTypeAnnotation(
              impliedType.annotation,
              typeParameterNames,
            ),
            span: impliedType.span,
          })),
          members: item.members.map((member) => {
            // An accounting line (`pow = widened`) supplies no body to resolve:
            // the member is *derived* from the module's `widens` declaration,
            // which may stand below this block, so `#supplyWidenedMembers`
            // synthesizes the lambda once every item is resolved. The
            // placeholder holds the line's name and span until then.
            if (member.value === undefined) {
              return {
                name: member.name.text,
                value: {
                  kind: "Lambda" as const,
                  parameters: [],
                  body: { kind: "ErrorExpr" as const, span: member.span },
                  span: member.span,
                },
                derived: true as const,
                span: member.span,
              };
            }
            // Constraints §4.6: a member definition is a `let` header, not a
            // `fun`, so its own body may not call its own name. The stack is what
            // tells a reference which name that is; a constraint *declaration's*
            // default body never pushes onto it, which is the exemption stated
            // in the same bullet.
            this.#honorMembers.push(member.name);
            const value = this.#resolveLambda(member.value, scope, impliedContext);
            this.#honorMembers.pop();
            return { name: member.name.text, value, span: member.span };
          }),
          span: item.span,
        };
      }
      case "Let": {
        // Modules §5.4 is layered: a binder in the *module's own scope* may
        // occlude a prelude name (the local one wins unqualified, the prelude's
        // stays reachable qualified), and a binder in an inner layer may shadow
        // the same one layer in — but neither may reuse a name the module's own
        // layers bind. `lookupLocal` stops at this module's layer; `#lookupTerm`
        // walks out through them all and stops short of the prelude wherever
        // this scope has reserved the name (§5.4's reservation).
        //
        // The test is scope *identity*, not nesting depth: the block body of a
        // module-level `let` runs at lambda depth 0 yet is an inner layer, so a
        // depth test would quietly license shadowing a *module* name there
        // (PR #89 finding F1) — which stays an error, prelude grant or not.
        const existing = scope === this.#moduleScope
          ? scope.lookupLocal(item.name.text)
          : this.#lookupTerm(item.name.text, scope);
        const pendingHit = this.#reportPendingRebinding(item.name, existing, scope);
        if (!pendingHit && existing !== undefined) {
          // The *parsed* field, not the resolved head below: whether the repair
          // can name a spelling is decided by the declaration form alone, and
          // stays decided even when the head itself failed to resolve.
          this.#reportRebinding(item.name, existing, item.widens !== undefined);
        }

        const widens = item.widens === undefined
          ? undefined
          : this.#resolveWidensHead(item.widens);

        const binding = this.#declare(item.name, "let", widens !== undefined);
        this.#pending.push({ name: item.name, kind: "let" });
        const value = this.#resolveExpr(Parsed.unwrapBindingValue(item.value), scope);
        this.#pending.pop();

        // Preserve the first valid meaning after an error instead of allowing
        // a rejected rebinding to change how subsequent names resolve.
        // Visible from the end of its own item: a sequential binder scopes over
        // the rest of its block (Statements §5.1), not over its own value.
        // A pending-name collision defines despite the error: the meaning it
        // displaces is the definition in progress, which later references could
        // only hit as a second, misleading self-reference diagnostic.
        if (existing === undefined || pendingHit) {
          scope.define(item.name.text, binding.symbol, item.span.end.offset);
        }

        return {
          kind: "Let",
          exported: item.exported,
          binding,
          ...(item.annotation === undefined
            ? {}
            : { annotation: this.#resolveTypeAnnotation(item.annotation) }),
          ...(widens === undefined ? {} : { widens }),
          value,
          span: item.span,
        };
      }
      case "TypeAlias": {
        const parameters = new Set(item.parameters.map(({ text }) => text));
        const used = parsedAnnotationTypeVariables(item.annotation);
        for (const parameter of item.parameters) {
          if (!used.has(parameter.text)) {
            this.#diagnostics.add({
              severity: "error",
              message: `type parameter \`${parameter.text}\` is not used by alias \`${item.name.text}\``,
              primary: parameter.span,
            });
          }
        }
        // Effects §2.2.1 / Declarations Preamble §5.1.1: an alias body has no
        // enclosing signature, so `->?` there denotes nothing. The check has to
        // stand *here*, before `#instantiateResolvedAlias` inlines the body
        // into a use site: inlined into a signature that happens to have an
        // inlet, the arrow would silently link — and transparency means one
        // alias would then name two colours across two mentions, which is not a
        // type. Refusing at the declaration is what keeps the alias one type.
        const orphaned = this.#refuseLinkedArrows(item.annotation);
        this.#resolvingAliases.push(item.name.text);
        const resolvedBody = this.#resolveTypeAnnotation(item.annotation, parameters);
        this.#resolvingAliases.pop();
        // Recovery: a refused `->?` becomes the impure constant in the stored
        // body, so the alias inlines as `->!` at every use site. Without this
        // the linked arrow would reach a use site whose signature happens to
        // have an inlet, link there, and make every call through the alias owe
        // `?` — a cascade of consequences from one already-reported defect.
        const annotation = orphaned ? constantifyLinkedArrows(resolvedBody) : resolvedBody;
        const resolvedAlias: Resolved.TypeAliasItem = {
          kind: "TypeAlias",
          exported: item.exported,
          name: item.name.text,
          parameters: item.parameters.map(({ text }) => text),
          annotation,
          span: item.span,
        };
        this.#typeAliases.set(item.name.text, resolvedAlias);
        return resolvedAlias;
      }
      case "Var": {
        // No module-level arm: `var` is confined to function bodies (§6), so the
        // only layer it can be granted is the prelude, and `#lookupTerm` is what
        // grants it.
        const existing = this.#lookupTerm(item.name.text, scope);
        const pendingHit = this.#reportPendingRebinding(item.name, existing, scope);
        if (!pendingHit && existing !== undefined) {
          this.#reportRebinding(item.name, existing);
        }
        if (this.#lambdaDepth === 0) {
          this.#diagnostics.add({
            severity: "error",
            message: "`var` is only allowed inside a function",
            primary: item.name.span,
          });
        }
        const binding = this.#declare(item.name, "var");
        this.#varOwners.set(binding.symbol, this.#lambdaDepth);
        this.#pending.push({ name: item.name, kind: "var" });
        const value = this.#resolveExpr(Parsed.unwrapBindingValue(item.value), scope);
        this.#pending.pop();
        if (existing === undefined || pendingHit) {
          scope.define(item.name.text, binding.symbol, item.span.end.offset);
        }
        return {
          kind: "Var",
          binding,
          ...(item.annotation === undefined
            ? {}
            : { annotation: this.#resolveTypeAnnotation(item.annotation) }),
          value,
          span: item.span,
        };
      }
      case "LetPattern": {
        const names = Parsed.patternNames(item.pattern);
        this.#pending.push(
          ...names.map((name) => ({ name, kind: "let" as const })),
        );
        const value = this.#resolveExpr(Parsed.unwrapBindingValue(item.value), scope);
        this.#pending.splice(this.#pending.length - names.length, names.length);
        const seen = new Map<string, Resolved.Binding>();
        this.#sequentialVisibleFrom = item.span.end.offset;
        const pattern = this.#resolvePattern(item.pattern, scope, seen, "sequential");
        this.#sequentialVisibleFrom = undefined;
        return {
          kind: "LetPattern",
          exported: false,
          pattern,
          value,
          span: item.span,
        };
      }
      case "Union": {
        const union = this.#unionDeclarations.get(item) ?? Resolved.unionId(this.#nextUnion++);
        const typeParameters = new Set(item.parameters.map(({ text }) => text));
        const seenConstructors = new Set<string>();
        const constructors = item.constructors.map((constructor) => {
          // §5.4's grant, extended to constructor names by #466: a prelude
          // constructor of this spelling is *occluded*, not collided with, so
          // `#lookupTerm` — which the frame's reservation has already made blind
          // to the prelude here — answers `undefined` and the declaration
          // claims. Unions the module declares or imports still fight: their
          // bindings are in the module's own layer, which no reservation
          // touches, so `existing` is defined and the hard error stands
          // (Unions §2).
          const existing = this.#lookupTerm(constructor.name.text, scope);
          if (seenConstructors.has(constructor.name.text)) {
            this.#diagnostics.add({
              severity: "error",
              message: `duplicate constructor \`${constructor.name.text}\``,
              primary: constructor.span,
            });
          } else if (existing !== undefined) {
            this.#reportRebinding(constructor.name, existing);
          }
          seenConstructors.add(constructor.name.text);
          const binding = this.#declare(constructor.name, "constructor");
          if (existing === undefined) {
            scope.define(constructor.name.text, binding.symbol);
          }
          return {
            binding,
            slots: constructor.slots.map((slot, index) => ({
              field: slot.name?.text ?? `item${index + 1}`,
              annotation: this.#resolveTypeAnnotation(slot.annotation, typeParameters),
              span: slot.span,
            })),
            span: constructor.span,
          };
        });
        const declaration: Resolved.Union = {
          id: union,
          name: item.name.text,
          parameters: item.parameters.map(({ text }) => text),
          declaredParameters: item.declaredParameters,
          derives: item.derives.map(({ text }) => text),
          opaque: item.opaque,
          representationVisible: true,
          // Stamped here and nowhere else: this is the *declaring* site, and
          // every other registration of this object — explicit import, prelude
          // seeding, `#includeNominals` — is a spread copy that carries the
          // path onward untouched (`Resolved.Union.declaringPath`).
          ...(this.#path === undefined ? {} : { declaringPath: this.#path }),
          span: item.name.span,
          constructors,
        };
        this.#unions.push(declaration);
        return {
          kind: "Union",
          exported: item.exported,
          opaque: item.opaque,
          union,
          name: item.name.text,
          parameters: item.parameters.map(({ text }) => text),
          declaredParameters: item.declaredParameters,
          derives: item.derives.map(({ text }) => text),
          constructors,
          span: item.span,
        };
      }
      case "RecordDeclaration": {
        const record = this.#recordDeclarations.get(item) ?? Resolved.recordId(this.#nextRecord++);
        // A record's name is its constructor in the term namespace (Products §5.1; Modules §3.1), so
        // it occludes exactly as a union's constructors do; see the union arm.
        const existing = this.#lookupTerm(item.name.text, scope);
        if (existing !== undefined) this.#reportRebinding(item.name, existing);
        const constructor = this.#declare(item.name, "record-constructor");
        if (existing === undefined) scope.define(item.name.text, constructor.symbol);
        const typeParameters = new Set(item.parameters.map(({ text }) => text));
        const fields = item.fields.map((field) => ({
          name: field.name.text,
          annotation: this.#resolveTypeAnnotation(field.annotation, typeParameters),
          span: field.span,
        }));
        const declaration: Resolved.RecordDeclaration = {
          id: record,
          name: item.name.text,
          parameters: item.parameters.map(({ text }) => text),
          declaredParameters: item.declaredParameters,
          derives: item.derives.map(({ text }) => text),
          opaque: item.opaque,
          representationVisible: true,
          // The declaring site; see the union arm above.
          ...(this.#path === undefined ? {} : { declaringPath: this.#path }),
          constructor,
          fields,
          span: item.span,
        };
        this.#records.push(declaration);
        return {
          kind: "RecordDeclaration",
          exported: item.exported,
          opaque: item.opaque,
          record,
          name: item.name.text,
          parameters: declaration.parameters,
          declaredParameters: item.declaredParameters,
          derives: declaration.derives,
          constructor,
          fields,
          span: item.span,
        };
      }
      case "Exception": {
        // An exception's name is a constructor too, and occludes on the same
        // terms; see the union arm.
        const existing = this.#lookupTerm(item.name.text, scope);
        if (existing !== undefined) this.#reportRebinding(item.name, existing);
        const binding = this.#declare(item.name, "constructor");
        if (existing === undefined) scope.define(item.name.text, binding.symbol);
        return {
          kind: "Exception",
          exported: item.exported,
          binding,
          slots: item.slots.map((slot, index) => ({
            field: slot.name?.text ?? `item${index + 1}`,
            annotation: this.#resolveTypeAnnotation(slot.annotation),
            span: slot.span,
          })),
          // Exceptions §7.1's brand, stamped where the declaration is made:
          // whichever module later names this constructor in a catch arm tests
          // *this* string, so it cannot be re-derived at the reading end.
          owner: this.#identity,
          span: item.span,
        };
      }
      case "Fun": {
        const binding = this.#predeclaredBindings.get(item) ?? this.#declare(item.name, "fun");
        this.#currentFunctions.push(binding.symbol);
        const value = this.#resolveLambda(item.value, scope);
        this.#currentFunctions.pop();

        return {
          kind: "Fun",
          exported: item.exported,
          binding,
          value,
          // The head travels with every member (#700): the checker groups on
          // its identity, scopes its binder variables over the block, and the
          // §4.1.1 advice names the head's spelling.
          ...(item.block === undefined
            ? {}
            : {
                block: {
                  id: item.block.id,
                  ...(item.block.typeParameters === undefined
                    ? {}
                    : {
                        typeParameters: item.block.typeParameters.map((parameter) => ({
                          name: parameter.name.text,
                          constraints: parameter.constraints.map(({ text }) => text),
                          span: parameter.span,
                        })),
                      }),
                  span: item.block.span,
                },
              }),
          span: item.span,
        };
      }
      case "ExprItem":
        return {
          kind: "ExprItem",
          expression: this.#resolveExpr(item.expression, scope),
          span: item.span,
        };
      case "ErrorItem":
        return item;
    }
  }

  /**
   * A block of `pattern [when g] => body` arms. One arm form serves `match`,
   * `try`'s `catch`, and the match catch clause (Pattern Matching §6.1–§6.2),
   * so one resolver does: each arm opens its own scope and its binders are head
   * binders (Statements §5).
   */
  #resolveArms(
    arms: readonly Parsed.MatchArm[],
    scope: Scope,
  ): readonly Resolved.MatchArm[] {
    return arms.map((arm) => {
      const armScope = this.#openScope(scope, arm.span);
      const pattern = this.#resolvePattern(arm.pattern, armScope, new Map(), "head");
      return {
        pattern,
        ...(arm.guard === undefined
          ? {}
          : { guard: this.#resolveExpr(arm.guard, armScope) }),
        body: this.#resolveExpr(arm.body, armScope),
        span: arm.span,
      };
    });
  }

  #resolveExpr(expression: Parsed.Expr, scope: Scope): Resolved.Expr {
    switch (expression.kind) {
      case "Name":
        return this.#resolveName(expression, scope);
      case "Unit":
      case "Integer":
      case "BigInt":
      case "Float":
      case "ErrorExpr":
        return expression;
      case "String":
        return {
          ...expression,
          parts: expression.parts.map((part) =>
            part.kind === "Text"
              ? part
              : {
                  ...part,
                  expression: this.#resolveExpr(part.expression, scope),
                },
          ),
        };
      case "Tuple":
      case "Vector":
        return {
          ...expression,
          elements: expression.elements.map((element) =>
            this.#resolveExpr(element, scope),
          ),
        };
      case "Record":
        return {
          kind: "Record",
          ...(expression.spread === undefined
            ? {}
            : { spread: this.#resolveExpr(expression.spread, scope) }),
          fields: expression.fields.map((field) => ({
            name: { text: field.name.text, startClass: field.name.startClass, span: field.name.span },
            punned: field.punned,
            value: this.#resolveExpr(field.value, scope),
            span: field.span,
          })),
          span: expression.span,
        };
      case "Group":
        return {
          ...expression,
          expression: this.#resolveExpr(expression.expression, scope),
        };
      case "Ascription":
        // The ordinary annotation path, deliberately: type names get their
        // identities (so the occurrence index reaches them) and holes get
        // resolver-assigned ids through the same mint, so an alias applied at a
        // hole shares seed and id exactly as it does in a binding annotation
        // (Ascription §9.2).
        return {
          kind: "Ascription",
          expression: this.#resolveExpr(expression.expression, scope),
          annotation: this.#resolveTypeAnnotation(expression.annotation),
          span: expression.span,
        };
      case "Block": {
        const blockScope = this.#openScope(scope, expression.span, true);
        return {
          ...expression,
          items: this.#resolveItems(expression.items, blockScope),
        };
      }
      case "Lambda":
        return this.#resolveLambda(expression, scope);
      case "If":
        return {
          kind: "If" as const,
          condition: this.#resolveExpr(expression.condition, scope),
          consequence: this.#resolveExpr(expression.consequence, scope),
          alternative: this.#resolveExpr(expression.alternative, scope),
          ...(expression.elseless ? { elseless: true } : {}),
          span: expression.span,
        };
      case "While":
        return {
          kind: "While",
          condition: this.#resolveExpr(expression.condition, scope),
          body: this.#resolveExpr(expression.body, scope) as Resolved.BlockExpr,
          span: expression.span,
        };
      case "For": {
        // The body, not the whole `for`: the iterable is resolved in the
        // *outer* scope, so a region spanning the construct would claim the
        // loop's binder is in scope inside the thing being iterated over.
        const loopScope = this.#openScope(scope, expression.body.span, true);
        const pattern = this.#resolvePattern(
          expression.pattern,
          loopScope,
          new Map(),
          "head",
        );
        return {
          kind: "For",
          pattern,
          iterable: this.#resolveExpr(expression.iterable, scope),
          body: this.#resolveExpr(expression.body, loopScope) as Resolved.BlockExpr,
          span: expression.span,
        };
      }
      case "Match": {
        const { catchArms, ...head } = expression;
        return {
          ...head,
          scrutinee: this.#resolveExpr(expression.scrutinee, scope),
          arms: this.#resolveArms(expression.arms, scope),
          // The match catch clause's arms (Exceptions §5.4) resolve exactly as
          // `try`'s do — one grammar, one arm form, one resolver.
          ...(catchArms === undefined
            ? {}
            : { catchArms: this.#resolveArms(catchArms, scope) }),
        };
      }
      case "Try":
        return {
          kind: "Try",
          body: this.#resolveExpr(expression.body, scope),
          arms: this.#resolveArms(expression.arms, scope),
          span: expression.span,
        };
      case "Call":
        if (
          expression.callee.kind === "Name" &&
          expression.callee.name.text === "hash" &&
          scope.lookup("hash") === undefined &&
          // `hash` is `Hash.hex`'s member, and since #742 the member channel
          // seeds nothing bare — so the scope lookup alone no longer says the
          // spelling is free. Without this second question the inversion would
          // hand bare `hash(x)` the compiler's own intrinsic form and re-open by
          // accident exactly the spelling ruling 4 closed.
          !this.#qualifiedOnlyPreludeNames.has("hash")
        ) {
          if (expression.arguments.length !== 1) {
            this.#diagnostics.add({
              severity: "error",
              message: `\`hash\` expects exactly one value, got ${expression.arguments.length}`,
              primary: expression.span,
            });
          }
          return {
            kind: "Hash",
            value: expression.arguments[0] === undefined
              ? { kind: "ErrorExpr", span: expression.span }
              : this.#resolveExpr(expression.arguments[0], scope),
            span: expression.span,
          };
        }
        if (
          expression.callee.kind === "Name" &&
          expression.callee.name.text === "throw" &&
          scope.lookup("throw") === undefined
        ) {
          if (expression.arguments.length !== 1) {
            this.#diagnostics.add({
              severity: "error",
              message: `\`throw\` expects exactly one exception, got ${expression.arguments.length}`,
              primary: expression.span,
            });
          }
          const argument = expression.arguments[0];
          return {
            kind: "Throw",
            exception: argument === undefined
              ? { kind: "ErrorExpr", span: expression.span }
              : this.#resolveExpr(argument, scope),
            span: expression.span,
          };
        }
        const refusedConsole = this.#refusedHostConsoleLog(expression, scope);
        if (refusedConsole !== undefined) {
          return {
            ...expression,
            callee: {
              ...refusedConsole,
              // The receiver is minted rather than resolved: resolving the name
              // would report the unknown `console` the refusal has already
              // spoken for, and this recovery owes one sentence.
              receiver: { kind: "ErrorExpr", span: refusedConsole.receiver.span },
              field: {
                text: refusedConsole.field.text,
                startClass: refusedConsole.field.startClass,
                span: refusedConsole.field.span,
              },
            },
            arguments: expression.arguments.map((argument) =>
              this.#resolveExpr(argument, scope),
            ),
          };
        }
        if (
          expression.callee.kind === "Access" &&
          !(expression.callee.receiver.kind === "Name" &&
            this.#namedModule(expression.callee.receiver.name.text) !== undefined) &&
          !this.#routesToCollectionCore(
            expression.callee.receiver,
            expression.callee.field.text,
            scope,
          )
        ) {
          this.#noteCompanionCandidate(expression.callee.field.text);
        }
        // The callee resolves inside this frame so that a refused bare prelude
        // name can spell its routes with the arguments written here (§5.5).
        // Restored rather than cleared: an argument may itself be a call.
        const outerCall = this.#calleeOf;
        this.#calleeOf = expression;
        const resolvedCallee = this.#resolveExpr(expression.callee, scope);
        this.#calleeOf = outerCall;
        return {
          ...expression,
          callee: resolvedCallee,
          arguments: expression.arguments.map((argument) =>
            this.#resolveExpr(argument, scope),
          ),
        };
      case "Access":
        if (expression.receiver.kind === "Name") {
          // Term position, so the top-down half of §3 applies before any read:
          // an alias whose import the walk has not reached binds `Lib.area` no
          // more than a `let` below binds its name.
          if (this.#reportUnreachedAlias(expression.receiver.name, expression.field, "term")) {
            return { kind: "ErrorExpr", span: expression.span };
          }
          // The guard below asks whether a *declaration* claims the qualifier,
          // and a prelude module is one: `#namedModule` covers the explicit
          // `import module` alias and the implicit prelude home alike (Modules
          // §6.4). Testing `#moduleAliases` alone would let the compiler's own
          // machinery outrank a prelude member, which is exactly the resolution
          // order Modules §5.5 forbids — and it is what kept `Seq.map` bound to
          // the intrinsic family after `Seq.hex` joined the set.
          //
          // One guard, not three: `Vector`'s, `Map`'s and `Set`'s went at their
          // self-declaration milestones (#370, #373), and `Node` is what the
          // family has left (`spec/intrinsics.md` §3.3, §9.2; #223). It is
          // `#runtime`-gated, so no user program can reach it at all.
          if (
            this.#runtime &&
            expression.receiver.name.text === "Node" &&
            ["empty", "get", "set", "copy"].includes(expression.field.text) &&
            scope.lookup("Node") === undefined &&
            this.#namedModule("Node") === undefined
          ) {
            return {
              kind: "CollectionOperation",
              collection: "Node",
              operation: expression.field.text,
              span: expression.span,
            };
          }
          // No primitive door here, and no transitional companion spelling
          // either: both died with the last companion (`spec/intrinsics.md`
          // §9.2, #344). Every primitive has a real module now, so `Float.mod`
          // and `Int.show` are the ordinary reads below — the module's exported
          // terms, then Modules §5.3's honored members.
          const importedModule = this.#namedModule(expression.receiver.name.text);
          if (importedModule !== undefined) {
            // §3.3/§5.3, in order: the module's exported terms, then the members
            // of constraints it **declares** — the polymorphic read, which is
            // why a declaring module that also honors answers with the
            // declaration — then the members of instances it honors at a type of
            // its own. Read after `terms`, never merged into it: a member is not
            // an independently importable name (§3.1).
            const symbol = importedModule.terms.get(expression.field.text) ??
              importedModule.constraintMembers.get(expression.field.text);
            if (symbol === undefined) {
              const honored = this.#honoredMemberAccess(
                importedModule,
                expression.receiver.name.text,
                expression.field,
              ) ??
                this.#providedRowMemberAccess(
                  importedModule,
                  expression.receiver.name.text,
                  expression.field,
                );
              if (honored !== undefined) return honored;
              this.#diagnostics.add({
                severity: "error",
                message: curatedCompanionMiss(
                  importedModule.module.companionPrimitive,
                  expression.field.text,
                ) ??
                  `module \`${expression.receiver.name.text}\` does not export \`${expression.field.text}\``,
                primary: expression.field.span,
              });
              return { kind: "ErrorExpr", span: expression.span };
            }
            this.#importedSymbols.set(symbol.id, symbol);
            const preludeLocal = this.#reachPreludeTerm(symbol.id);
            if (preludeLocal !== undefined) {
              return { kind: "Name", symbol: symbol.id, text: preludeLocal, span: expression.span };
            }
            return {
              kind: "Name",
              symbol: symbol.id,
              text: `${expression.receiver.name.text}.${expression.field.text}`,
              span: expression.span,
            };
          }
          // No module alias answered, so rule 1's own sentence gets its turn
          // before the receiver decays to an unknown name (#577).
          if (this.#typeIsNotAModule(expression.receiver, scope)) {
            return { kind: "ErrorExpr", span: expression.span };
          }
        }
        return {
          ...expression,
          receiver: this.#resolveExpr(expression.receiver, scope),
          field: {
            text: expression.field.text,
            startClass: expression.field.startClass,
            span: expression.field.span,
          },
        };
      case "Index":
        return {
          ...expression,
          receiver: this.#resolveExpr(expression.receiver, scope),
          index: this.#resolveExpr(expression.index, scope),
        };
      case "Unary":
        return {
          ...expression,
          operand: this.#resolveExpr(expression.operand, scope),
        };
      case "Binary": {
        const left = this.#resolveExpr(expression.left, scope);
        // The right operand of a pipe is a *stage*, and a refused prelude name
        // in its callee seat must not be described as an ordinary call (§5.5's
        // "the program's own words" has no words for the receiver here).
        const outerStage = this.#pipeStage;
        if (expression.operator === "Pipe") this.#pipeStage = expression.right;
        const right = this.#resolveExpr(expression.right, scope);
        this.#pipeStage = outerStage;
        return { ...expression, left, right };
      }
      case "Comparison":
        return {
          ...expression,
          operands: expression.operands.map((operand) =>
            this.#resolveExpr(operand, scope),
          ),
        };
      case "Assignment":
        if (expression.target.kind !== "Name") {
          this.#diagnostics.add({
            severity: "error",
            message: "assignment targets a bare name; records and tuples are immutable",
            primary: expression.target.span,
          });
        }
        return {
          ...expression,
          target: this.#resolveExpr(expression.target, scope),
          value: this.#resolveExpr(expression.value, scope),
        };
    }
  }

  /**
   * The constructor `Alias.Ctor` names, for a **pattern** — Modules §3.3's
   * qualified form, which Unions §2 delegates to and Modules §5.4 requires in
   * pattern position as well as value position.
   *
   * `#namedModule` is the same door value position uses (the `Access` arm), so
   * an explicit `import module` alias and a prelude module's own name (§6.4's
   * guaranteed home) answer alike, and neither consults the bare-name layer —
   * which is the point: an occluded prelude constructor is unreachable bare and
   * must stay reachable here.
   *
   * Answers `undefined` having reported, so the caller has nothing to add.
   */
  #qualifiedConstructor(
    qualifier: Parsed.Name,
    name: Parsed.Name,
  ): Resolved.SymbolId | undefined {
    // Pattern position is term position (§5.4 reads the two as one scope), so
    // the alias's top-down half governs here exactly as in the `Access` arm.
    if (this.#reportUnreachedAlias(qualifier, name, "constructor")) return undefined;
    const module = this.#namedModule(qualifier.text);
    if (module === undefined) {
      this.#diagnostics.add({
        severity: "error",
        message: `unknown module alias \`${qualifier.text}\``,
        primary: qualifier.span,
      });
      return undefined;
    }
    // `terms` only. A constraint member is not a constructor, and Modules §5.3's
    // honored-member read answers calls, not patterns.
    const symbol = module.terms.get(name.text);
    if (symbol === undefined) {
      this.#diagnostics.add({
        severity: "error",
        message: `module \`${qualifier.text}\` does not export \`${name.text}\``,
        primary: name.span,
      });
      return undefined;
    }
    // The same kind test the bare arm makes, so one spelling cannot match what
    // the other refuses. `record-constructor` joins it at #591: Pattern
    // Matching §2.2 grants the constructor pattern to nominal `record`
    // constructors as well as union ones, and Modules §4.2 makes that
    // eliminator name-carried — so it qualifies through a module alias by
    // §3.3's ordinary door, exactly as a union constructor does.
    if (symbol.kind !== "constructor" && symbol.kind !== "record-constructor") {
      this.#diagnostics.add({
        severity: "error",
        message: `\`${qualifier.text}.${name.text}\` is not a constructor`,
        primary: { fileId: qualifier.span.fileId, start: qualifier.span.start, end: name.span.end },
      });
      return undefined;
    }
    // Registered so `#symbol` can answer for it, exactly as the `Access` arm
    // does in value position. Deliberately *not* `#reachPreludeTerm`: a
    // constructor matched in a pattern compiles to its string tag and needs no
    // import (see `#preludeImport`).
    this.#importedSymbols.set(symbol.id, symbol);
    return symbol.id;
  }

  #resolvePattern(
    pattern: Parsed.Pattern,
    scope: Scope,
    seen: Map<string, Resolved.Binding>,
    binderClass: BinderClass,
    sharedBindings?: ReadonlyMap<string, Resolved.Binding>,
  ): Resolved.Pattern {
    if (
      pattern.kind === "Wildcard" ||
      pattern.kind === "Unit" ||
      pattern.kind === "Integer" ||
      pattern.kind === "String"
    ) return pattern;
    if (pattern.kind === "Or") {
      const namesByAlternative = pattern.alternatives.map((alternative) =>
        Parsed.patternNames(alternative)
      );
      const expected = new Set(namesByAlternative[0]?.map(({ text }) => text));
      for (const names of namesByAlternative.slice(1)) {
        const actual = new Set(names.map(({ text }) => text));
        for (const name of new Set([...expected, ...actual])) {
          if (expected.has(name) !== actual.has(name)) {
            this.#diagnostics.add({
              severity: "error",
              message: `\`${name}\` must be bound in every alternative of an or-pattern`,
              primary: pattern.span,
            });
          }
        }
      }

      const sourceNames = new Map<string, Parsed.Name>();
      for (const name of namesByAlternative.flat()) {
        if (!sourceNames.has(name.text)) sourceNames.set(name.text, name);
      }
      const shared = new Map(sharedBindings);
      for (const [text, name] of sourceNames) {
        if (shared.has(text)) continue;
        const claimed = this.#claimBinder(name, scope, binderClass);
        const binding = this.#declare(name, declaredKind(binderClass));
        shared.set(text, binding);
        if (claimed) {
          scope.define(
            text,
            binding.symbol,
            binderClass === "sequential" ? this.#sequentialVisibleFrom : undefined,
          );
        }
      }
      return {
        kind: "Or",
        alternatives: pattern.alternatives.map((alternative) =>
          this.#resolvePattern(alternative, scope, new Map(), binderClass, shared)
        ),
        span: pattern.span,
      };
    }
    if (pattern.kind === "As") {
      const nested = this.#resolvePattern(
        pattern.pattern,
        scope,
        seen,
        binderClass,
        sharedBindings,
      );
      const binder = this.#resolvePattern(
        { kind: "Binding", name: pattern.name, span: pattern.name.span },
        scope,
        seen,
        binderClass,
        sharedBindings,
      );
      return {
        kind: "As",
        pattern: nested,
        binding: (binder as Resolved.BindingPattern).binding,
        span: pattern.span,
      };
    }
    if (pattern.kind === "Constructor") {
      if (pattern.qualifier !== undefined) {
        // Modules §3.3's qualified constructor, in pattern position. It reads
        // the module directly and never the bare-name layer, so it is exactly
        // the escape hatch §5.4's constructor occlusion leans on: a module whose
        // own `union` took `Less` over still matches an `Ordering` by
        // `Prelude.Less`.
        const qualified = this.#qualifiedConstructor(pattern.qualifier, pattern.name);
        if (qualified === undefined) return { kind: "Wildcard", span: pattern.span };
        return {
          kind: "Constructor",
          symbol: qualified,
          text: pattern.name.text,
          tag: this.#symbol(qualified).name,
          // The constructor half only: a rename or a go-to-definition lands on
          // the name, the qualifier being the module's.
          nameSpan: pattern.name.span,
          arguments: pattern.arguments.map((argument) =>
            this.#resolvePattern(argument, scope, seen, binderClass, sharedBindings),
          ),
          span: pattern.span,
        };
      }
      // §5.4 reads pattern position and value position as **one scope**, so the
      // bare spelling goes through the same reserved lookup a value reference
      // does (#466). Below an occluding declaration that lands on the module's
      // own constructor; above it the prelude is invisible and
      // `#findLaterDeclaration` supplies §7.2's declared-later error in its
      // pattern wording — the shape a user-written union already draws there.
      //
      // Both constructor kinds answer here (#591). A nominal record's
      // eliminator is its constructor pattern (Pattern Matching §2.2, Modules
      // §4.2), and it is *name-carried*: the name has to be in scope by
      // ordinary lexical scoping or import, which is exactly what this lookup
      // asks and nothing more — the representation's own reach (§4.2, #587)
      // never puts a name here.
      const bound = this.#lookupTerm(pattern.name.text, scope);
      const kind = bound === undefined ? undefined : this.#symbol(bound).kind;
      const scoped = bound !== undefined &&
          (kind === "constructor" || kind === "record-constructor")
        ? bound
        : undefined;
      const later = bound === undefined
        ? this.#findLaterDeclaration(pattern.name.text)
        : undefined;
      // Modules §5.1 rule 3 (#763): the fallback answers here exactly as it
      // answers in an expression — §5.4 reads pattern and value position as one
      // scope — and it answers *after* scope and *before* the door, which is
      // the order Pattern Matching §2.2 states.
      const symbol = scoped ?? (bound === undefined && later === undefined
        ? this.#companionConstructor(pattern.name.text)
        : undefined);
      const arguments_ = (): readonly Resolved.Pattern[] =>
        pattern.arguments.map((argument) =>
          this.#resolvePattern(argument, scope, seen, binderClass, sharedBindings),
        );
      if (symbol === undefined) {
        if (bound !== undefined || later !== undefined) {
          this.#diagnostics.add(
            later === undefined
              ? {
                  severity: "error",
                  message: `unknown constructor \`${pattern.name.text}\``,
                  primary: pattern.name.span,
                }
              : {
                  severity: "error",
                  message: `\`${pattern.name.text}\` is declared later in this block; ` +
                    "declarations are read top-down — move " +
                    `${later.move ?? `the ${later.owner ?? "declaration"}'s declaration`} ` +
                    "above this use",
                  primary: pattern.name.span,
                  labels: [{ span: later.name.span, message: "declared here" }],
                },
          );
          return { kind: "Wildcard", span: pattern.span };
        }
        // **The door** (Pattern Matching §2.2, #763). Scope has nothing for the
        // spelling, so the head is left open and the checker resolves it
        // against the expected type — the scrutinee's at the top of a pattern,
        // the instantiated slot type beneath — which the resolver cannot see.
        // Nothing is refused here: a spelling no expected type holds is the
        // checker's closed-door report (§12), and §5.5's qualified-only prelude
        // constructors are exactly what the door reaches (`Less` bare over an
        // `Ordering`), so the bare-prelude refusal does not fire in pattern
        // position at all.
        //
        // The qualified spellings this module could write travel with the node,
        // because they are a property of *this* module's scope while the
        // checker's own spelling tables are keyed by symbol — which a head
        // nothing resolved has none of.
        const qualifications = this.#constructorQualifications(pattern.name.text);
        return {
          kind: "Constructor",
          open: true,
          text: pattern.name.text,
          tag: pattern.name.text,
          nameSpan: pattern.name.span,
          ...(qualifications.length === 0 ? {} : { qualifications }),
          arguments: arguments_(),
          span: pattern.span,
        };
      }
      return {
        kind: "Constructor",
        symbol,
        text: pattern.name.text,
        // The declaration's name, never the one written here: a constructor
        // reached through rule 3's fallback under an alias whose module
        // declared it otherwise would put a spelling in front of the reader
        // that no constructed value carries (#468).
        tag: this.#symbol(symbol).name,
        nameSpan: pattern.name.span,
        arguments: arguments_(),
        span: pattern.span,
      };
    }
    if (pattern.kind === "Tuple") {
      return {
        ...pattern,
        elements: pattern.elements.map((element) =>
          this.#resolvePattern(element, scope, seen, binderClass, sharedBindings),
        ),
      };
    }
    if (pattern.kind === "Vector") {
      const resolvedRest = pattern.rest === undefined
        ? undefined
        : {
            index: pattern.rest.index,
            span: pattern.rest.span,
            ...(pattern.rest.pattern === undefined
              ? {}
              : { pattern: this.#resolvePattern(pattern.rest.pattern, scope, seen, binderClass, sharedBindings) }),
          };
      return {
        kind: "Vector",
        elements: pattern.elements.map((element) =>
          this.#resolvePattern(element, scope, seen, binderClass, sharedBindings)
        ),
        ...(resolvedRest === undefined ? {} : { rest: resolvedRest }),
        span: pattern.span,
      };
    }
    if (pattern.kind === "Record") {
      return {
        kind: "Record",
        fields: pattern.fields.map((field) => ({
          name: field.name.text,
          nameSpan: field.name.span,
          pattern: this.#resolvePattern(
            field.pattern,
            scope,
            seen,
            binderClass,
            sharedBindings,
          ),
          span: field.span,
        })),
        span: pattern.span,
      };
    }

    // Binding twice within one pattern is simultaneous duplication, not
    // shadowing (§5.1 rule 3): it is an error in every class, and it settles the
    // name before the class ever gets a say. An or-pattern's alternatives share
    // one binding per name (`sharedBindings`), already claimed above.
    const duplicate = seen.get(pattern.name.text);
    if (duplicate !== undefined) {
      this.#diagnostics.add({
        severity: "error",
        message: `\`${pattern.name.text}\` is bound twice in this pattern`,
        primary: pattern.name.span,
        labels: [{ span: duplicate.span, message: "first binding is here" }],
      });
    }
    const claimed = duplicate === undefined && sharedBindings === undefined &&
      this.#claimBinder(pattern.name, scope, binderClass);

    const binding = sharedBindings?.get(pattern.name.text) ??
      this.#declare(pattern.name, declaredKind(binderClass));
    seen.set(pattern.name.text, binding);
    if (claimed) {
      scope.define(
        pattern.name.text,
        binding.symbol,
        binderClass === "sequential" ? this.#sequentialVisibleFrom : undefined,
      );
    }
    return { kind: "Binding", binding, span: pattern.span };
  }

  /**
   * Settles one pattern binder against the names already in scope, per its
   * Statements §5 class, and reports the conflict if it has one. Answers whether
   * the binder may go on to own its name in `scope`; a rejected binder leaves the
   * existing meaning in place, so the names after it still resolve to what they
   * did before the error.
   */
  #claimBinder(name: Parsed.Name, scope: Scope, binderClass: BinderClass): boolean {
    // Rule 2: a head binder may shadow anything, and it owns its scope outright.
    if (binderClass === "head") return true;

    // A pattern parameter is a head binder too, but it shares the lambda's scope
    // with the parameters beside it, so a name already bound *there* is a second
    // parameter of that name — duplication (rule 3), not shadowing. Everything
    // further out it may shadow, exactly as a plain parameter does.
    if (binderClass === "parameter") {
      const sibling = scope.lookupLocal(name.text);
      if (sibling === undefined) return true;
      // Order the pair by source position, not by which one resolved second.
      // Every plain parameter binds before any pattern parameter is resolved, so
      // a pattern binder is always the later claimant even when it was written
      // first — reporting in claim order would label the *second* `p` of
      // `f({p}, p)` as the first one. Two plain parameters have never had that
      // problem, and this keeps the whole family reading the same way: the
      // primary marks the repeat, the label marks what it repeats.
      const [first, second] = orderedBySource(this.#symbol(sibling).bindingSpan, name.span);
      this.#diagnostics.add({
        severity: "error",
        message: `duplicate parameter \`${name.text}\``,
        primary: second,
        labels: [{ span: first, message: "first parameter is here" }],
      });
      return false;
    }

    // Rule 1, layered by Modules §5.4: a binder in the module's own scope may
    // occlude a prelude name on the same scope-identity test `let`, `fun`, and
    // constraint members use; in an inner layer it may shadow the prelude and
    // nothing else, which is `#lookupTerm`'s reservation — every layer the
    // module wrote stays under the full ban, so the lookup still walks out
    // through all of them. Every name a `let` pattern binds arrives here, so the
    // grant reaches `let {show, hash} = record` by construction.
    const existing = scope === this.#moduleScope
      ? scope.lookupLocal(name.text)
      : this.#lookupTerm(name.text, scope);
    // A pending-name collision is reported but still claims: there is no
    // meaning worth preserving over it, and defining the refused binder keeps
    // later references from cascading into a self-reference diagnostic.
    if (this.#reportPendingRebinding(name, existing, scope)) return true;
    if (existing === undefined) return true;
    this.#reportRebinding(name, existing);
    return false;
  }

  /**
   * Refuses a bare reference that landed on the prelude layer for a name two or
   * more visible members export, reporting every qualified home.
   *
   * The test is on the *layer the name resolved in*, not on the symbol: a
   * prelude term and an explicit import of it are one `SymbolId`, and an
   * explicit import is a module-level binding (Modules §5.4). So is a local
   * declaration of the name. Both occlude the prelude layer whole, collided or
   * not, and both are rewrites this diagnostic does not need to name — the
   * reference in front of the reader is bare, and the local, obvious fix for a
   * bare reference is to qualify it.
   *
   * The refusal reaches the bare spelling and nothing else. `Seq.empty` never
   * comes through here (the `Access` case resolves a qualifier against
   * `#namedModule`), and neither does `values.length()`: dispatch is
   * type-directed (Method Syntax §1) and reads `#preludeTermsByName`, which holds
   * every member's term precisely so an occluded one stays reachable. Dot call is
   * the mitigation this ruling leans on, so it must not be collateral.
   */
  /**
   * Refuses a bare reference to a prelude name **outside the bare set**, naming
   * the routes that do reach it (Modules §5.5, §10's three rows; #742).
   *
   * The name resolved to nothing, because §5.5 seeds nothing in the term
   * namespace by default — so without this the reader would get `unknown name
   * \`map\`` for an operation the prelude exports four times over, or the bare
   * `unknown constructor \`Null\`` the boundary unions used to draw. One message
   * shape serves all three channels; only the routes differ.
   *
   * Answers whether it reported, so the caller can poison the expression the way
   * an unknown name does — one diagnostic for the program, not a cascade.
   *
   * Read only where the ordinary lookup has already failed *and* no later
   * declaration explains it. A module that declares the spelling owns it, above
   * the declaration as below (§5.4's reservation), and the declared-later error
   * is the truer sentence there.
   */
  /**
   * Puts a prelude constraint member's spelling back into the bare layer for a
   * module that **honors** the constraint — Modules §5.5's own carve-out: "a
   * member's *in-module* spelling is untouched: an honoring module binds its
   * members at module level (Constraints §4.6)".
   *
   * #742 took the member channel's bare seeding from *consumers*, and the
   * honoring module is not one: `subtract(left, right) = multiply(left, right)`
   * reads a sibling of the block it is written in, and every law that governs
   * that read — §4.6's own-name refusal, its ambiguity-between-constraints
   * refusal, its declared-later error — is written against the spelling
   * resolving. Refusing it here would replace three specific diagnostics with
   * one that misreads the program as a consumer's.
   *
   * Read from `#boundHonoredMembers` and **not** from the wider index §4.6's
   * laws use: the carve-out is for a spelling this module *binds*, so a
   * `derives` clause — which writes no member anywhere — puts nothing back, and
   * neither does a block's defaulted member. A spelling this module does not
   * bind stays refused, and the routes recorded for it stay in place. The name
   * is dropped from `#qualifiedOnlyPreludeNames` in the same breath, because a
   * spelling cannot be both in the layer and refused for not being in it.
   */
  #seedHonoredMemberSpellings(): void {
    for (const name of this.#boundHonoredMembers) {
      const symbol = this.#preludeMembersByName.get(name);
      if (symbol === undefined) continue;
      this.#preludeScope.define(name, symbol);
      this.#qualifiedOnlyPreludeNames.delete(name);
    }
  }

  #refusedBarePrelude(name: Parsed.Name): boolean {
    const routes = this.#qualifiedOnlyPreludeNames.get(name.text);
    if (routes === undefined || routes.length === 0) return false;
    this.#diagnostics.add({
      severity: "error",
      message: refusedBarePreludeMessage(name.text, routes, this.#writtenArguments(name)),
      primary: name.span,
    });
    return true;
  }

  /**
   * The source text of each argument of the call this name is the callee of, or
   * `undefined` where it is not a callee — Modules §5.5's "the program's own
   * words".
   *
   * Read from the module's text by span, because that is the only rendering that
   * cannot invent a spelling: a pretty-printer over the parsed argument would
   * normalize whitespace, quoting and parentheses, and a rewrite the reader
   * cannot find in their own line is worse than no rewrite. Answers `undefined`
   * when the caller supplied no text (a bare `resolve` in a test), which degrades
   * to the non-call form rather than to a wrong one.
   */
  #writtenArguments(name: Parsed.Name): WrittenArguments | undefined {
    const call = this.#calleeOf;
    const text = this.#text;
    if (
      call === undefined || text === undefined ||
      call.callee.kind !== "Name" || call.callee.name !== name
    ) {
      return undefined;
    }
    // A **pipe stage** is not a call the message can rebuild. `xs |> map(f)`
    // writes `map(f)`, whose one written argument is the *transform*, not the
    // receiver — rendering it as a call turned `map(f)` into `f.map()`, which
    // names the wrong value in the wrong seat. The stage's real first argument
    // is the pipe's left operand, which is not this node's to read, so the
    // message drops to the non-call shape: the routes, named, with no arguments
    // — which is what a bare stage (`xs |> length`) already draws.
    if (this.#pipeStage === call) return undefined;
    const texts = call.arguments.map((argument) =>
      text.slice(argument.span.start.offset, argument.span.end.offset)
    );
    // An argument spanning lines would put a newline inside a diagnostic, and a
    // rewrite the reader has to reflow is not one. The routes are still named.
    if (texts.some((argument) => argument.includes("\n"))) return undefined;
    const first = call.arguments[0];
    return {
      texts,
      receiver: first === undefined || structuralReceiver(first)
        ? undefined
        : dispatchesAsWritten(first)
        ? texts[0]
        : `(${texts[0]})`,
      vectorLiteral: first !== undefined && vectorLiteralReceiver(first),
    };
  }

  #refusedAmbiguousPrelude(name: Parsed.Name, scope: Scope): boolean {
    if (scope.lookupOwner(name.text) !== this.#preludeScope) return false;
    const homes = this.#preludeHomesByName.get(name.text) ?? [];
    if (homes.length < 2) return false;
    this.#diagnostics.add({
      severity: "error",
      message: `the prelude name \`${name.text}\` is ambiguous: exported by ` +
        `${conjoin(homes.map((home) => `\`${home}\``), "and")}; write ` +
        `${conjoin(homes.map((home) => `\`${home}.${name.text}\``), "or")}`,
      primary: name.span,
    });
    return true;
  }

  /**
   * The signpost standing where the host console operation used to be (#417),
   * answering with the refused callee so its caller can rebuild the call.
   *
   * `console.log(...)` is not an operation of this language: there is no ambient
   * `console`, and the debugging probe a writer reaching for it wants is
   * `Debug.log` (Effects §6.2). The shape check that once admitted the form is
   * kept only to say so, because the sentences it decays to — an unknown name,
   * and a member access on it — name neither the mistake nor the replacement.
   *
   * Saying so is the whole of the difference. The caller keeps the *shape* the
   * ordinary recovery would have built, resolved arguments and all, so
   * `console.log(x, nmae)` reports the typo exactly as `console.warn(x, nmae)`
   * does and the editor's queries still reach into the argument list. Arguments
   * are resolved and retained, never resolved and dropped: a dropped reference
   * would leave its prelude term in the used set with nothing referring to it.
   *
   * A `console` in scope takes the call back: the receiver is that binding, the
   * access means whatever the binding means, and no report is owed.
   *
   * The rewrite is offered for a single argument and no other arity. This pass
   * sees no types, and `log` takes one rendered `String` — so one argument is
   * the shape a mechanical rewrite can produce honestly, and a wrongly-typed one
   * meets `log`'s parameter at the checker, which is a better place to arrive
   * than nowhere. Several arguments or none have no such rewrite: the
   * interpolation is the writer's move.
   */
  #refusedHostConsoleLog(
    expression: Parsed.CallExpr,
    scope: Scope,
  ): Parsed.AccessExpr | undefined {
    const callee = expression.callee;
    if (
      callee.kind !== "Access" ||
      callee.receiver.kind !== "Name" ||
      callee.receiver.name.text !== "console" ||
      callee.field.text !== "log" ||
      scope.lookup("console") !== undefined
    ) {
      return undefined;
    }
    this.#diagnostics.add({
      severity: "error",
      message: "`console.log` is not a Hexagon operation; the debugging probe " +
        "is `Debug.log`",
      primary: callee.span,
      ...(expression.arguments.length === 1
        ? {
          fixes: [{
            message: "write `Debug.log`",
            edits: [{ span: callee.span, replacement: "Debug.log" }],
          }],
        }
        : {}),
    });
    return callee;
  }

  /**
   * Modules §5.1 rule 1's own sentence, at the one seat that owes it (#577).
   *
   * `Name.` resolves in the module-alias namespace first; where nothing there
   * answers and the *type* namespace holds the spelling, the refusal says which
   * namespace the name actually lives in and names the two routes that reach
   * what the writer wanted. Without it the receiver decays to a bare
   * `unknown name` — true of the term namespace, and silent about the type
   * standing one namespace over, which is the whole content of the mistake.
   *
   * The check is the **failed-resolution** half of the family and no more (the
   * #577 ruling's v1 scope): a spelling that resolves as a term is somebody
   * else's — a record import binds its constructor, so `Shape.make` is a field
   * access on a constructor-typed head, and its inverted mismatch is #642's.
   * The order refusal is read first for the same reason it is read first
   * in `#resolveName`: "declared later" is the truer sentence where it applies,
   * and this one would be a false classification of a name that resolves fine
   * one line down.
   *
   * The type namespace is read through the same four maps every annotation
   * reads (`#resolveTypeAnnotation`), so an imported type, a prelude type, an
   * alias and an extern type all count — the message's repair is the same for
   * each, and "a type exists" is exactly what rule 1 conditions on. Rule 1's
   * own "uppercase immediately followed by `.`" is asked separately rather than
   * inferred from those maps: a `type foo` in an `extern` block is refused for
   * its lowercase alias and still registered, and a second sentence classifying
   * it would be a report about the compiler's recovery rather than the source.
   */
  #typeIsNotAModule(receiver: Parsed.NameExpr, scope: Scope): boolean {
    const name = receiver.name.text;
    if (
      receiver.name.startClass !== "upper" ||
      this.#lookupTerm(name, scope) !== undefined ||
      this.#findLaterDeclaration(name) !== undefined ||
      !(this.#unionNames.has(name) || this.#recordNames.has(name) ||
        this.#typeAliases.has(name) || this.#externTypeNames.has(name))
    ) {
      return false;
    }
    this.#diagnostics.add({
      severity: "error",
      message: `\`${name}\` is a type, not a module; import its home module ` +
        "to qualify through it",
      primary: receiver.span,
      importModuleRepair: { name, namespace: "type" },
    });
    return true;
  }

  #resolveName(expression: Parsed.NameExpr, scope: Scope): Resolved.Expr {
    const symbol = this.#lookupTerm(expression.name.text, scope);
    if (symbol !== undefined) {
      // Before anything is made of the symbol: a refused reference names no
      // term, so it must not join the used-prelude set the synthesized import is
      // built from, and `ErrorExpr` poisons the checker's view of it the way an
      // unknown name does — one diagnostic for the program, not a cascade.
      if (this.#refusedAmbiguousPrelude(expression.name, scope)) {
        return { kind: "ErrorExpr", span: expression.span };
      }
      if (this.#refusedMemberReference(expression.name, symbol)) {
        return { kind: "ErrorExpr", span: expression.span };
      }
      const owner = this.#varOwners.get(symbol);
      if (owner !== undefined && owner < this.#lambdaDepth) {
        this.#diagnostics.add({
          severity: "error",
          message: `\`${expression.name.text}\` is a \`var\` and cannot be used inside a lambda; copy it to a \`let\` first`,
          primary: expression.span,
          labels: [{ span: this.#symbol(symbol).bindingSpan, message: "mutable binding declared here" }],
        });
      }
      if (this.#preludeTerms.has(symbol)) this.#usedPreludeSymbols.add(symbol);
      return {
        kind: "Name",
        symbol,
        text: expression.name.text,
        span: expression.span,
      };
    }

    const pending = this.#findPending(expression.name.text);
    if (pending !== undefined) {
      this.#diagnostics.add({
        severity: "error",
        message: pending.kind === "let"
          ? `\`${expression.name.text}\` is not in scope in its own \`let\` definition; \`let\` is non-recursive — use \`fun\`.`
          : `\`${expression.name.text}\` is not in scope in its own \`var\` definition; initialize it from an earlier binding`,
        primary: expression.span,
        labels: [{ span: pending.name.span, message: "binding declared here" }],
      });
      return { kind: "ErrorExpr", span: expression.span };
    }

    const later = this.#findLaterDeclaration(expression.name.text);
    // Modules §5.1 rule 3 (#763): the term namespace had nothing, so the
    // companion fallback gets its turn — before the refusals, and after every
    // reading that could have answered.
    if (later === undefined) {
      const companion = this.#companionConstructor(expression.name.text);
      if (companion !== undefined) {
        return {
          kind: "Name",
          symbol: companion,
          text: expression.name.text,
          span: expression.span,
        };
      }
    }
    // §5.5's refusal is read *after* the declared-later one and before the
    // unknown name: a module that declares the spelling lower down means its
    // own, and §5.4's reservation has already made the prelude invisible there.
    if (later === undefined && this.#refusedBarePrelude(expression.name)) {
      return { kind: "ErrorExpr", span: expression.span };
    }
    // Modules §10's row: a constructor a visible alias's module exports but
    // whose spelling the alias itself does not carry — `Circle(1.0)` under
    // `import Shape from "./shape"`. Expression position has no door (§9.13),
    // so the qualified spelling is the whole repair, written in the program's
    // own words: one exporter names it, several name each, none falls through
    // to the plain unknown-name report.
    const qualifications = later === undefined
      ? this.#constructorQualifications(expression.name.text)
      : [];
    if (qualifications.length > 0) {
      this.#diagnostics.add({
        severity: "error",
        message: bareConstructorMessage(
          expression.name.text,
          qualifications,
          this.#writtenArguments(expression.name),
        ),
        primary: expression.span,
      });
      return { kind: "ErrorExpr", span: expression.span };
    }
    this.#diagnostics.add(
      later === undefined
        ? {
            severity: "error",
            message: `unknown name \`${expression.name.text}\``,
            primary: expression.span,
          }
        : {
            severity: "error",
            message: `\`${expression.name.text}\` is declared later in this block; ` +
              (later.split
                ? "only members of one `fun` block recurse together; wrap both " +
                  "definitions as its members"
                : "declarations are read top-down — move " +
                  `${later.move ?? "its declaration"} above this use`),
            primary: expression.span,
            labels: [{ span: later.name.span, message: "declared here" }],
          },
    );

    return { kind: "ErrorExpr", span: expression.span };
  }

  /**
   * The declaration of `name` further down an enclosing block, if there is one.
   *
   * *(#700.)* `split` marks the case §7.3 owns rather than §7.2: both sides are
   * `fun`s of the same enclosing block, so they are two `fun` **blocks** and the
   * repair is the mechanical wrap — adjacency is no longer load-bearing, and
   * moving a declaration between them can no longer change what they mean.
   */
  #findLaterDeclaration(
    name: string,
  ): (LaterDeclaration & { readonly split: boolean }) | undefined {
    for (let index = this.#blockDeclarations.length - 1; index >= 0; index -= 1) {
      const frame = this.#blockDeclarations[index];
      const declaration = frame?.later.get(name);
      if (frame === undefined || declaration === undefined) continue;
      return {
        ...declaration,
        split: declaration.fun &&
          this.#currentFunctions.some((symbol) => frame.funSymbols.has(symbol)),
      };
    }
    return undefined;
  }

  #resolveLambda(
    expression: Parsed.LambdaExpr,
    scope: Scope,
    impliedContext?: { readonly owner: string; readonly names: ReadonlySet<string> },
  ): Resolved.LambdaExpr {
    this.#lambdaDepth += 1;
    const lambdaScope = this.#openScope(scope, expression.span);
    const parameters = expression.parameters.map((parameter) => {
      const existing = lambdaScope.lookupLocal(parameter.name.text);
      const binding = this.#declare(parameter.name, "parameter");

      if (existing === undefined) {
        lambdaScope.define(parameter.name.text, binding.symbol);
      } else {
        const previous = this.#symbol(existing);
        this.#diagnostics.add({
          severity: "error",
          message: `duplicate parameter \`${parameter.name.text}\``,
          primary: parameter.name.span,
          labels: [
            { span: previous.bindingSpan, message: "first parameter is here" },
          ],
        });
      }

      const annotation = parameter.annotation === undefined
        ? undefined
        : this.#resolveTypeAnnotation(parameter.annotation, new Set(), impliedContext);
      return {
        ...binding,
        ...(annotation === undefined ? {} : { annotation }),
      };
    });

    // A pattern parameter's binders are head binders whichever spelling
    // introduced them (Pattern Matching §6.5), so they bind here — in the
    // lambda's own scope, beside the plain parameters and under the same rules —
    // rather than in the body, where the surrounding `let`'s sequential class
    // would be the only one on offer (Statements §5.2's pre-desugar warning).
    // The equivalent `let` still opens the body, and is checked, typed, and
    // emitted as a written one: only the classification happens up here.
    const destructurings = (expression.destructurings ?? []).map(
      (destructuring): Resolved.LetPatternItem => {
        const value = this.#resolveExpr(
          { kind: "Name", name: destructuring.name, span: destructuring.span },
          lambdaScope,
        );
        return {
          kind: "LetPattern",
          exported: false,
          pattern: this.#resolvePattern(
            destructuring.pattern,
            lambdaScope,
            new Map(),
            "parameter",
          ),
          value,
          // The seat, carried for one diagnostic's sake (Pattern Matching §6.5):
          // downstream this is a `let` in every other respect.
          parameter: true,
          span: destructuring.span,
        };
      },
    );

    const resolved: Resolved.LambdaExpr = {
      kind: "Lambda",
      parameters,
      ...(expression.typeParameters === undefined
        ? {}
        : {
            typeParameters: expression.typeParameters.map((parameter) => ({
              name: parameter.name.text,
              constraints: parameter.constraints.map(({ text }) => text),
              span: parameter.span,
            })),
          }),
      ...(expression.returnAnnotation === undefined
        ? {}
        : { returnAnnotation: this.#resolveTypeAnnotation(expression.returnAnnotation, new Set(), impliedContext) }),
      body: openedWith(destructurings, this.#resolveExpr(expression.body, lambdaScope)),
      span: expression.span,
    };
    this.#lambdaDepth -= 1;
    return resolved;
  }

  #resolveTypeAnnotation(
    annotation: Parsed.TypeAnnotation,
    typeParameters = new Set<string>(),
    impliedContext?: { readonly owner: string; readonly names: ReadonlySet<string> },
    substitutions: ReadonlyMap<string, Resolved.TypeAnnotation> = new Map(),
  ): Resolved.TypeAnnotation {
    if (annotation.kind === "Function") {
      return {
        kind: "Function",
        parameters: annotation.parameters.map((parameter) =>
          this.#resolveTypeAnnotation(parameter, typeParameters, impliedContext, substitutions)
        ),
        result: this.#resolveTypeAnnotation(
          annotation.result,
          typeParameters,
          impliedContext,
          substitutions,
        ),
        ...(annotation.effect === undefined ? {} : { effect: annotation.effect }),
        ...(annotation.arrowSpan === undefined ? {} : { arrowSpan: annotation.arrowSpan }),
        span: annotation.span,
      };
    }
    if (annotation.kind === "Tuple") {
      return {
        kind: "Tuple",
        elements: annotation.elements.map((element) =>
          this.#resolveTypeAnnotation(element, typeParameters, impliedContext, substitutions),
        ),
        span: annotation.span,
      };
    }
    if (annotation.kind === "Record") {
      return {
        kind: "Record",
        fields: annotation.fields.map((field) => ({
          name: field.name.text,
          annotation: this.#resolveTypeAnnotation(field.annotation, typeParameters, impliedContext, substitutions),
          span: field.span,
        })),
        open: annotation.open,
        ...(annotation.tail === undefined ? {} : { tail: annotation.tail.text }),
        span: annotation.span,
      };
    }
    if (annotation.kind === "Hole") {
      // Minted per *written* `_`, which is the only place a hole enters the
      // resolved tree: every later copy is made by substitution, which spreads
      // the node and so carries this id — and its seeded constraints — with it.
      return {
        kind: "Hole",
        id: this.#nextHole++,
        constraints: annotation.constraints.map(({ text }) => text),
        span: annotation.span,
      };
    }
    if (annotation.kind === "TypeVariable") {
      const replacement = substitutions.get(annotation.name.text);
      if (replacement !== undefined) return withTypeSpan(replacement, annotation.span);
      return {
        kind: "TypeVariable",
        name: annotation.name.text,
        span: annotation.span,
      };
    }
    const name = annotation.kind === "AppliedType"
      ? annotation.constructor.text
      : annotation.name.text;
    if (annotation.qualifier !== undefined) {
      const imported = this.#namedModule(annotation.qualifier.text);
      if (imported === undefined) {
        this.#diagnostics.add({
          severity: "error",
          message: `unknown module alias \`${annotation.qualifier.text}\``,
          primary: annotation.qualifier.span,
        });
        return { kind: "ErrorType", span: annotation.span };
      }
      const arguments_ = annotation.kind === "AppliedType"
        ? annotation.arguments.map((argument) => this.#resolveTypeAnnotation(argument, typeParameters, impliedContext, substitutions))
        : [];
      // FFI Part 7 §2.4 rung 3 reads the *occurrence*, so the alias this seat
      // was written through rides the resolved node from here (`TypeQualifier`).
      // Only a **source-written** `import module` qualifies: `#namedModule` also
      // answers for a prelude companion (§6.4's qualified home), which carries no
      // import line at all and whose identity reaches rung 4 instead.
      const qualifier = this.#qualifierOf(annotation.qualifier.text, name);
      const union = imported.unions.get(name);
      if (union !== undefined) {
        return this.#resolvedNominalType(
          "union", union, name, arguments_, annotation.span, qualifier,
        );
      }
      const record = imported.records.get(name);
      if (record !== undefined) {
        return this.#resolvedNominalType(
          "record", record, name, arguments_, annotation.span, qualifier,
        );
      }
      const alias = imported.aliases.get(name);
      // A type alias has no identity of its own — a face carries its expansion
      // (FFI Part 7 §1) — so the qualifier stops here rather than being pushed
      // onto the nominals the expansion mentions. Those carry whatever their
      // *writer* wrote, which is the whole of the travelling-spelling rule.
      if (alias !== undefined) return this.#instantiateResolvedAlias(alias, arguments_, annotation.span);
      const externType = imported.externTypes.get(name);
      if (externType !== undefined) {
        if (arguments_.length > 0) {
          this.#diagnostics.add({
            severity: "error",
            message: `extern type \`${name}\` is monomorphic and takes no type arguments`,
            primary: annotation.span,
          });
        }
        return {
          kind: "ExternType",
          externType: externType.externType,
          name: `${annotation.qualifier.text}.${name}`,
          ...(qualifier === undefined ? {} : { qualifier }),
          span: annotation.span,
        };
      }
      this.#diagnostics.add({
        severity: "error",
        message: `module \`${annotation.qualifier.text}\` does not export type \`${name}\``,
        primary: annotation.span,
      });
      return { kind: "ErrorType", span: annotation.span };
    }
    if (impliedContext?.names.has(name)) {
      if (annotation.kind === "AppliedType") {
        this.#diagnostics.add({
          severity: "error",
          message: `\`${name}\` is an implied type of \`${impliedContext.owner}\` and cannot be applied in v1`,
          primary: annotation.span,
        });
        return { kind: "ErrorType", span: annotation.span };
      }
      return {
        kind: "ImpliedType",
        constraint: impliedContext.owner,
        name,
        span: annotation.span,
      };
    }
    const alias = this.#typeAliases.get(name);
    if (alias !== undefined) {
      const arguments_ = annotation.kind === "AppliedType"
        ? annotation.arguments.map((argument) => this.#resolveTypeAnnotation(argument, typeParameters, impliedContext, substitutions))
        : [];
      return isResolvedTypeAlias(alias)
        ? this.#instantiateResolvedAlias(alias, arguments_, annotation.span)
        : this.#resolveAlias(name, arguments_, annotation.span, typeParameters, impliedContext, substitutions);
    }
    const externType = this.#externTypeNames.get(name);
    if (externType !== undefined) {
      if (annotation.kind === "AppliedType") {
        this.#diagnostics.add({
          severity: "error",
          message: `extern type \`${name}\` is monomorphic and takes no type arguments`,
          primary: annotation.span,
        });
      }
      return { kind: "ExternType", externType, name, span: annotation.span };
    }
    const union = this.#unionNames.get(name);
    if (union !== undefined) {
      const arguments_ = annotation.kind === "AppliedType"
        ? annotation.arguments.map((argument) =>
          this.#resolveTypeAnnotation(argument, typeParameters, impliedContext, substitutions)
        )
        : [];
      const expected = this.#unionArities.get(name) ?? 0;
      if (arguments_.length !== expected) {
        this.#diagnostics.add({
          severity: "error",
          message: `type \`${name}\` expects ${expected} argument${expected === 1 ? "" : "s"}, but ${arguments_.length} were provided`,
          primary: annotation.span,
        });
      }
      return {
        kind: "Union",
        union,
        name,
        arguments: arguments_,
        span: annotation.span,
      };
    }
    // Declarations outrank the compiler's own type machinery (Modules §5.5): the
    // record table is consulted here, alongside the alias/extern/union tables
    // above, so the intrinsic branch below is reached only when no declaration
    // claims the name. Records were once tested *after* the intrinsics while
    // unions were tested before them; that asymmetry was the resolution-order
    // defect (defect log entry 6), not a rule.
    const declaredRecord = this.#recordNames.get(name);
    if (declaredRecord !== undefined) {
      const arguments_ = annotation.kind === "AppliedType"
        ? annotation.arguments.map((argument) =>
          this.#resolveTypeAnnotation(argument, typeParameters, impliedContext, substitutions)
        )
        : [];
      const expected = this.#recordArities.get(name) ?? 0;
      if (arguments_.length !== expected) {
        this.#diagnostics.add({
          severity: "error",
          message: `type \`${name}\` expects ${expected} argument${expected === 1 ? "" : "s"}, but ${arguments_.length} were provided`,
          primary: annotation.span,
        });
      }
      return { kind: "RecordDeclaration", record: declaredRecord, name, arguments: arguments_, span: annotation.span };
    }
    if (annotation.kind === "AppliedType") {
      // Modules §5.1 rule 2: the compiler-owned boundary types stay **last** —
      // after declarations *and* after the companion fallback, because the
      // fallback resolves to a user's declaration reached through the user's own
      // import, and §5.5 gives the compiler no claim that outranks one. This is
      // the one place the fallback changes a program that already resolved: a
      // module imported under a boundary spelling and exporting a same-spelled
      // type now means the user's type. The other members of the intrinsic
      // inventory below (`Vector`, `Set`, `Map`, `JsSet`, `JsMap`) are not
      // boundary types and keep answering first — rule 2's carve names three
      // spellings and conservativity is exact at every other.
      if (name === "Array" || name === "Nullable" || (this.#runtime && name === "Node")) {
        const companion = this.#companionType(
          name, annotation, typeParameters, impliedContext, substitutions,
        );
        if (companion !== undefined) return companion;
      }
      if (this.#runtime && name === "Node") {
        // `Node(a)` is spellable only inside a runtime module; elsewhere it falls
        // through to the unknown-generic-type path, keeping the intrinsic hidden.
        if (annotation.arguments.length !== 1) {
          this.#diagnostics.add({
            severity: "error",
            message: `type \`Node\` expects 1 argument, but ${annotation.arguments.length} were provided`,
            primary: annotation.span,
          });
        }
        const element = annotation.arguments[0] === undefined
          ? { kind: "ErrorType" as const, span: annotation.span }
          : this.#resolveTypeAnnotation(annotation.arguments[0], typeParameters, impliedContext, substitutions);
        return { kind: "Node", element, span: annotation.span };
      }
      // `Seq` is gone from this list: it is a prelude *declaration* now (Loops
      // §6.6), reached through the record table above. The names left are the
      // boundary intrinsics that no `.hex` module declares — `JsMap` and
      // `JsSet` (FFI Part 10 §1) among them, reached here for the same reason
      // `Array` is: a borrowed foreign view has no Hexagon declaration site.
      if (
        name === "Vector" || name === "Set" || name === "Array" ||
        name === "Nullable" || name === "JsSet"
      ) {
        if (annotation.arguments.length !== 1) {
          this.#diagnostics.add({
            severity: "error",
            message: `type \`${name}\` expects 1 argument, but ${annotation.arguments.length} were provided`,
            primary: annotation.span,
          });
        }
        const argument = annotation.arguments[0] === undefined
          ? { kind: "ErrorType" as const, span: annotation.span }
          : this.#resolveTypeAnnotation(annotation.arguments[0], typeParameters, impliedContext, substitutions);
        // Written as spelled. The nullish-absorption collapse (FFI Part 11 §8;
        // Part 2 §2.1) is the checker's one seat — `Checker#prune` — because
        // the equation has to hold of a type however it arrives, and an
        // annotation is only one of the ways.
        if (name === "Nullable") return { kind: "Nullable", value: argument, span: annotation.span };
        if (name === "Vector") return { kind: "Vector", element: argument, span: annotation.span };
        if (name === "Set") return { kind: "Set", element: argument, span: annotation.span };
        if (name === "JsSet") return { kind: "JsSet", element: argument, span: annotation.span };
        return { kind: "Array", element: argument, span: annotation.span };
      }
      if (name === "Map" || name === "JsMap") {
        if (annotation.arguments.length !== 2) {
          this.#diagnostics.add({
            severity: "error",
            message: `type \`${name}\` expects 2 arguments, but ${annotation.arguments.length} were provided`,
            primary: annotation.span,
          });
        }
        const key = annotation.arguments[0] === undefined
          ? { kind: "ErrorType" as const, span: annotation.span }
          : this.#resolveTypeAnnotation(annotation.arguments[0], typeParameters, impliedContext, substitutions);
        const value = annotation.arguments[1] === undefined
          ? { kind: "ErrorType" as const, span: annotation.span }
          : this.#resolveTypeAnnotation(annotation.arguments[1], typeParameters, impliedContext, substitutions);
        if (name === "JsMap") return { kind: "JsMap", key, value, span: annotation.span };
        return { kind: "Map", key, value, span: annotation.span };
      }
      // Nothing in the type namespace and no intrinsic answered: rule 2's
      // companion fallback gets its turn before the refusal, exactly as it does
      // for the nullary spelling below.
      const companion = this.#companionType(
        name, annotation, typeParameters, impliedContext, substitutions,
      );
      if (companion !== undefined) return companion;
      // `JsValue` takes no parameters (FFI Part 11 §2), so an applied spelling
      // gets the boundary family's arity diagnostic rather than the
      // unknown-generic-type refusal, and resolves to the type anyway — the
      // author plainly meant it.
      if (name === "JsValue") {
        this.#diagnostics.add({
          severity: "error",
          message: `type \`JsValue\` expects 0 arguments, but ${annotation.arguments.length} were provided`,
          primary: annotation.span,
        });
        return { kind: "JsValue", span: annotation.span };
      }
      this.#diagnostics.add({
        severity: "error",
        message: `unknown generic type \`${name}\``,
        primary: annotation.span,
      });
      return { kind: "ErrorType", span: annotation.span };
    }
    if (isPrimitiveName(annotation.name.text)) {
      return {
        kind: "Primitive",
        name: annotation.name.text,
        span: annotation.span,
      };
    }
    if (annotation.name.text === "Range") {
      return { kind: "Range", span: annotation.span };
    }

    const owners = this.#impliedTypeOwners.get(name);
    if (owners !== undefined) {
      const ownerNames = [...owners].sort();
      const ownership = ownerNames.length === 1
        ? `of \`${ownerNames[0]}\``
        : `declared by ${ownerNames.map((owner) => `\`${owner}\``).join(" and ")}`;
      this.#diagnostics.add({
        severity: "error",
        message: `\`${name}\` is an implied type ${ownership} and cannot appear in type expressions`,
        primary: annotation.span,
      });
      return { kind: "ErrorType", span: annotation.span };
    }
    // Modules §5.1 rule 2's **companion fallback**, the nullary spelling: the
    // type namespace has nothing, so a visible module alias `Name` whose module
    // exports a type `Name` answers here — §5.3's idiom is what it exists for.
    // The alias still binds nothing, which is why this sits at the end of the
    // chain rather than beside the tables: every declaration and every type
    // import above has already had its turn and won outright where it could.
    const companion = this.#companionType(
      name, annotation, typeParameters, impliedContext, substitutions,
    );
    if (companion !== undefined) return companion;
    // `JsValue` (FFI Part 11 §2) is a compiler-owned boundary type and the only
    // nullary one, so it answers exactly where `Array` and `Nullable` do in the
    // applied path: **last**, after every declaration and after rule 2's
    // companion fallback (Modules §5.1 rule 2, §5.5). The compiler holds no
    // resolution claim that outranks a user's own `JsValue`.
    if (name === "JsValue") return { kind: "JsValue", span: annotation.span };
    // The fallback declined — the alias exports no type of its own spelling — so
    // the refusal stands, naming the repairs the exported inventory actually
    // offers (Modules §10's row).
    const aliased = this.#moduleAliases.get(name);
    if (aliased !== undefined) {
      this.#diagnostics.add({
        severity: "error",
        message: this.#aliasIsNotATypeMessage(name, aliased),
        primary: annotation.span,
      });
      return { kind: "ErrorType", span: annotation.span };
    }
    this.#diagnostics.add({
      severity: "error",
      message: `unknown type \`${name}\``,
      primary: annotation.span,
    });
    return { kind: "ErrorType", span: annotation.span };
  }

  #declare(
    name: Parsed.Name,
    kind: Resolved.SymbolKind,
    widens = false,
  ): Resolved.Binding {
    const symbol = Resolved.symbolId(this.#nextSymbol++);
    this.#symbols.set(symbol, {
      id: symbol,
      name: name.text,
      kind,
      bindingSpan: name.span,
      ...(widens ? { widens: true as const } : {}),
    });
    return { symbol, name: name.text, span: name.span };
  }

  #resolveAlias(
    name: string,
    arguments_: readonly Resolved.TypeAnnotation[],
    span: Source.Span,
    outerParameters = new Set<string>(),
    impliedContext?: { readonly owner: string; readonly names: ReadonlySet<string> },
    outerSubstitutions: ReadonlyMap<string, Resolved.TypeAnnotation> = new Map(),
  ): Resolved.TypeAnnotation {
    const alias = this.#typeAliases.get(name);
    if (alias === undefined || isResolvedTypeAlias(alias)) return { kind: "ErrorType", span };
    if (this.#resolvingAliases.includes(name)) {
      const cycle = [...this.#resolvingAliases.slice(this.#resolvingAliases.indexOf(name)), name];
      this.#diagnostics.add({
        severity: "error",
        message: `recursive type alias cycle: ${cycle.map((part) => `\`${part}\``).join(" -> ")}`,
        primary: span,
      });
      return { kind: "ErrorType", span };
    }
    if (arguments_.length !== alias.parameters.length) {
      this.#diagnostics.add({
        severity: "error",
        message: `type alias \`${name}\` expects ${alias.parameters.length} argument${alias.parameters.length === 1 ? "" : "s"}, but ${arguments_.length} were provided`,
        primary: span,
      });
    }
    const replacements = new Map(outerSubstitutions);
    alias.parameters.forEach((parameter, index) => {
      replacements.set(parameter.text, arguments_[index] ?? { kind: "ErrorType", span });
    });
    this.#resolvingAliases.push(name);
    const result = this.#resolveTypeAnnotation(
      alias.annotation,
      new Set([...outerParameters, ...alias.parameters.map(({ text }) => text)]),
      impliedContext,
      replacements,
    );
    this.#resolvingAliases.pop();
    return withTypeSpan(result, span);
  }

  /**
   * Effects §4.4's report, for every `->?` written in an alias body.
   *
   * Every occurrence is reported, not just the first: they are independent
   * mistakes and a writer fixing one arrow should not have to recompile to
   * discover the next.
   */
  #refuseLinkedArrows(annotation: Parsed.TypeAnnotation): boolean {
    let found = false;
    const walk = (node: unknown): void => {
      if (node === null || typeof node !== "object") return;
      if (Array.isArray(node)) {
        for (const child of node) walk(child);
        return;
      }
      const record = node as {
        kind?: unknown;
        effect?: unknown;
        arrowSpan?: Source.Span;
      };
      if (record.kind === "Function" && record.effect === "linked") {
        found = true;
        const arrowSpan = record.arrowSpan;
        if (arrowSpan !== undefined) {
          this.#diagnostics.add({
            severity: "error",
            message:
              "`->?` is the caller's colour, and this position has no caller to " +
              "choose it — an alias is a type fragment, not a signature; write " +
              "`->!` for a function that pulls the world, or `->` for one that does not",
            primary: arrowSpan,
            fixes: [{
              message: "write `->!`",
              edits: [{ span: arrowSpan, replacement: "->!" }],
            }],
          });
        }
      }
      for (const [key, child] of Object.entries(record)) {
        if (key === "span" || key === "arrowSpan") continue;
        walk(child);
      }
    };
    walk(annotation);
    return found;
  }

  #instantiateResolvedAlias(
    alias: Resolved.TypeAliasItem,
    arguments_: readonly Resolved.TypeAnnotation[],
    span: Source.Span,
  ): Resolved.TypeAnnotation {
    if (arguments_.length !== alias.parameters.length) {
      this.#diagnostics.add({
        severity: "error",
        message: `type alias \`${alias.name}\` expects ${alias.parameters.length} argument${alias.parameters.length === 1 ? "" : "s"}, but ${arguments_.length} were provided`,
        primary: span,
      });
    }
    const replacements = new Map(alias.parameters.map((parameter, index) => [
      parameter,
      arguments_[index] ?? { kind: "ErrorType" as const, span },
    ]));
    return substituteResolvedType(alias.annotation, replacements, span);
  }

  #resolvedNominalType(
    kind: "union" | "record",
    declaration: Resolved.Union | Resolved.RecordDeclaration,
    name: string,
    arguments_: readonly Resolved.TypeAnnotation[],
    span: Source.Span,
    qualifier?: Resolved.TypeQualifier,
  ): Resolved.TypeAnnotation {
    const expected = declaration.parameters.length;
    if (arguments_.length !== expected) {
      this.#diagnostics.add({
        severity: "error",
        message: `type \`${name}\` expects ${expected} argument${expected === 1 ? "" : "s"}, but ${arguments_.length} were provided`,
        primary: span,
      });
    }
    const written = qualifier === undefined ? {} : { qualifier };
    return kind === "union"
      ? { kind: "Union", union: (declaration as Resolved.Union).id, name, arguments: arguments_, ...written, span }
      : { kind: "RecordDeclaration", record: (declaration as Resolved.RecordDeclaration).id, name, arguments: arguments_, ...written, span };
  }

  /**
   * FFI Part 7 §2.4 rung 3's record of one qualified occurrence, or `undefined`
   * where the qualifier is not a source-written namespace import's.
   *
   * A qualifier is a reference to a **binding**, not a name for the type, which
   * is why it carries the module whose scope holds that binding beside the local
   * it is bound under — a reference to a binding means nothing where the binding
   * is not. Nothing downstream re-derives it: a pass that rewrites types has no
   * reason to preserve a spelling, so an occurrence's has to be carried
   * deliberately, and this is where it is minted.
   *
   * The `#moduleAliases` test is **defence in depth, not a live filter**: a
   * prelude companion's qualified home (`Prelude.Ordering`, §6.4) is the only
   * other thing `#namedModule` answers for, and the emitter declines it a second
   * time on its own — its alias set is built from this module's `import` items,
   * which a companion has none of. The test states the rule where the rule is
   * about resolution, so the qualifier that travels is never one no import line
   * could serve.
   */
  #qualifierOf(alias: string, member: string): Resolved.TypeQualifier | undefined {
    if (!this.#moduleAliases.has(alias)) return undefined;
    return { module: this.#moduleFileId, alias, member };
  }

  /**
   * Modules §5.1 rule 2's **companion fallback**, type half.
   *
   * A bare `Name` in type position that the type namespace has nothing for
   * resolves to the type `Name` exported by a visible module alias `Name` — the
   * whole of §5.3's companion idiom in one reading, and the reason the blessed
   * consumer example compiles at all (#531).
   *
   * It **answers, never binds**: nothing enters the type namespace, so a
   * same-spelled declaration or type import wins outright with no collision and
   * no diagnostic, and every call site here sits *after* the namespace's own
   * tables. The answer is exactly what `Name.Name` would have resolved to —
   * literally the qualified path's own machinery — which is what makes the
   * arity report, the opacity rule, and emission identical for both spellings.
   *
   * `undefined` means "declined": the caller proceeds to whatever answered
   * before the fallback existed (at the boundary spellings, the boundary
   * intrinsic; elsewhere, the refusal).
   */
  #companionType(
    name: string,
    annotation: Parsed.TypeAnnotation & { readonly kind: "NamedType" | "AppliedType" },
    typeParameters: Set<string>,
    impliedContext: { readonly owner: string; readonly names: ReadonlySet<string> } | undefined,
    substitutions: ReadonlyMap<string, Resolved.TypeAnnotation>,
  ): Resolved.TypeAnnotation | undefined {
    // An explicit `import module` alias first, then the prelude companion of the
    // same name (§6.4's qualified home) — `#namedModule`'s own order, and the
    // §5.4 one. The prelude half is inert in practice: a prelude module's types
    // are seeded into the type namespace, so they answer above this and the
    // fallback never reaches them.
    const aliased = this.#namedModule(name);
    if (aliased === undefined) return undefined;
    const union = aliased.unions.get(name);
    const record = aliased.records.get(name);
    const alias = aliased.aliases.get(name);
    const externType = aliased.externTypes.get(name);
    if (
      union === undefined && record === undefined &&
      alias === undefined && externType === undefined
    ) {
      return undefined;
    }
    // Arguments are resolved only once the fallback has committed: a declining
    // fallback must leave no diagnostic behind, and the branch that answers
    // instead will resolve them itself.
    const arguments_ = annotation.kind === "AppliedType"
      ? annotation.arguments.map((argument) =>
        this.#resolveTypeAnnotation(argument, typeParameters, impliedContext, substitutions)
      )
      : [];
    if (union !== undefined) {
      return this.#resolvedNominalType("union", union, name, arguments_, annotation.span);
    }
    if (record !== undefined) {
      return this.#resolvedNominalType("record", record, name, arguments_, annotation.span);
    }
    if (alias !== undefined) {
      return this.#instantiateResolvedAlias(alias, arguments_, annotation.span);
    }
    if (arguments_.length > 0) {
      this.#diagnostics.add({
        severity: "error",
        message: `extern type \`${name}\` is monomorphic and takes no type arguments`,
        primary: annotation.span,
      });
    }
    return {
      kind: "ExternType",
      externType: externType!.externType,
      name,
      span: annotation.span,
    };
  }

  /**
   * Modules §10's row for an alias standing where a type belongs, once the
   * companion fallback has declined it.
   *
   * The **exported inventory drives which repairs are named**. One exported
   * type is the case the row is written for — the alias is one rename away from
   * resolving, so all three working spellings are offered, realias included.
   * With none, or with several (where "the type it exports" would be a false
   * singular and no one realias is the answer), the general form stands.
   */
  #aliasIsNotATypeMessage(name: string, aliased: ModuleInterface): string {
    const specifier = this.#moduleAliasSpecifiers.get(name);
    const exported = [
      ...aliased.unions.keys(),
      ...aliased.records.keys(),
      ...aliased.aliases.keys(),
      ...aliased.externTypes.keys(),
    ];
    const only = exported.length === 1 ? exported[0]! : undefined;
    if (only === undefined || specifier === undefined) {
      return `\`${name}\` is a module alias, not a type; the types it exports are reached ` +
        `through it, as \`${name}.Name\``;
    }
    return `\`${name}\` is a module alias, not a type; write \`${name}.${only}\` for the type it ` +
      `exports, name it bare with \`type ${only} = ${name}.${only}\`, ` +
      `or realias as \`import ${only} from ${JSON.stringify(specifier)}\``;
  }

  #includeNominals(imported: ModuleInterface, qualifier?: string): void {
    for (const union of imported.unions.values()) {
      if (!this.#unions.some(({ id }) => id === union.id)) this.#unions.push({ ...union, representationVisible: false });
    }
    for (const record of imported.records.values()) {
      if (!this.#records.some(({ id }) => id === record.id)) this.#records.push({ ...record, representationVisible: false });
    }
    for (const externType of imported.externTypes.values()) {
      if (!this.#externTypes.some(({ externType: id }) => id === externType.externType)) {
        this.#externTypes.push({
          ...externType,
          localName: qualifier === undefined
            ? externType.localName
            : `${qualifier}.${externType.localName}`,
        });
      }
    }
  }

  /**
   * Synthesized imports for the prelude terms this module actually references —
   * one per prelude module, carrying exactly the used names and no more.
   * Constructors matched in patterns compile to their string tags and need no
   * import, so only value references (tracked in `#resolveName`) contribute here.
   */
  /**
   * Every identifier the emitted module already binds at its top level.
   *
   * Deliberately **not** a list of binder forms. The first version of this dodge
   * enumerated `let`/`fun`/`var` and silently missed named imports, extern
   * declarations, let-patterns, and constraint members — the same mistake as
   * defect 11, where a rule stated over "module-level binders" was fixed at the
   * two forms that happened to be in front of me. Two structural sources close
   * the set instead:
   *
   * 1. **every symbol this module declared.** `#declare` is the single funnel
   *    for all of them, so no binder form — present or future — can escape it.
   *    It is broader than "top level" (parameters and body locals are in there
   *    too), and being broader is the safe direction: a spare distinguished
   *    local costs nothing, a missed one is a `SyntaxError` at load.
   * 2. **every local an import introduces**, which are bindings this module owns
   *    without declaring.
   */
  #emittedTopLevelNames(resolvedItems: readonly Resolved.Item[]): Set<string> {
    const names = new Set<string>();
    for (const symbol of this.#symbols.values()) names.add(symbol.name);
    for (const item of resolvedItems) {
      if (item.kind !== "Import") continue;
      if (item.form.kind === "Namespace") names.add(item.form.alias);
      for (const name of item.form.names) names.add(name.local);
    }
    return names;
  }

  #preludeImport(
    span: Source.Span,
    resolvedItems: readonly Resolved.Item[],
  ): readonly Resolved.Item[] {
    const taken = this.#emittedTopLevelNames(resolvedItems);
    const namesBySpecifier = new Map<string, Resolved.ImportName[]>();
    for (const symbol of this.#usedPreludeSymbols) {
      const term = this.#preludeTerms.get(symbol);
      const specifier = this.#preludeSpecifierBySymbol.get(symbol);
      if (term === undefined || specifier === undefined) continue;
      const names = namesBySpecifier.get(specifier) ?? [];
      // Reaching `Result.tally` from a module that itself binds `tally` is
      // exactly what §6.4 exists for, so importing it *as* `tally` would collide
      // with the binding it is there to see past — and a redeclared identifier
      // is a `SyntaxError` at load, after a clean compile.
      //
      // The dodging local is a generated name like any other, so it probes the
      // way they all do since #425: the preferred spelling first, then
      // underscored numeric suffixes from 1 — `__prelude_map`, then
      // `__prelude_map_1`. The digits used to be glued straight on.
      let local = term.name;
      for (let attempt = 0; taken.has(local); attempt += 1) {
        local = `__prelude_${term.name}${attempt === 0 ? "" : `_${attempt}`}`;
      }
      taken.add(local);
      names.push({ imported: term.name, local, symbol, span });
      namesBySpecifier.set(specifier, names);
    }
    return [...namesBySpecifier].map(([specifier, names]) => ({
      kind: "Import" as const,
      specifier,
      form: { kind: "Named" as const, names },
      // Deliberately empty (#153). This import exists because a *term* was
      // referenced, and instance availability must not depend on that: the
      // prelude's instances ride `Module.preludeInstances` instead, which every
      // module gets whether or not it names a prelude term. Carrying them here
      // as well would put a second copy of the same identity into this module's
      // interface, which consumers would then predict imports of and
      // intermediates re-export — the transit chain #153 exists to cut.
      instances: [],
      // Empty for the same reason: the prelude's constraints are the
      // pre-registered ones, in scope by name in every module with no import.
      constraints: [],
      // Not empty for that reason: these describe the exporting module's own
      // output, and a prelude module names its exports like any other.
      internalNames: internalNameInputs(
        this.#preludeInterfaceBySpecifier.get(specifier),
      ),
      specializableTerms: specializableTerms(
        this.#preludeInterfaceBySpecifier.get(specifier),
      ),
      synthesized: true,
      span,
    }));
  }

  /**
   * The prelude-owned instances visible here, in normative prelude order (#153).
   *
   * Every visible prelude module's interface instances, which is both what it
   * declares and what it carries. Availability, not emission: nothing here is an
   * import, and an entry only becomes one if the emitter finds the elaborated
   * Core actually referencing its dictionary.
   *
   * Called after resolution so `#preludeUnions` is fully seeded — the `Bool`
   * filter below reads it.
   */
  #preludeInstanceChannel(span: Source.Span): readonly Resolved.PreludeInstance[] {
    // The pinned `Bool`'s four constraints are satisfied structurally at every
    // use site (#147 — see the checker's `#resolveRequirement`), so its
    // dictionaries are never referenced and must never be offered: seeding them
    // would put an instance in the checker's universe that competes with the
    // structural answer, and emitting them would import four dead dictionaries
    // into every module that so much as names `Bool` in a signature.
    //
    // What this filter changes, stated exactly, because it is narrower than it
    // looks. Removing it changes no emission and no accepted program: the
    // structural answer wins before instance selection in every reachable case,
    // including a generic dictionary-passing call site (`fun eq<a: Eq>(x, y) =
    // x == y` applied to `Bool`), and the emitter's referenced-only gate then
    // drops what is never selected. Its one observable effect is on programs
    // that already fail: an orphan `honor Eq<Bool>` reports *only* the orphan
    // error, where without the filter it would also report `duplicate instance
    // of Eq<Bool>`.
    //
    // That is an asymmetry against `Ordering` and `Option`, whose orphan honors
    // do report the collision (`prelude-instance-availability.test.ts` pins it),
    // and it is the chosen side. A `Bool` requirement is answered by the pin,
    // not by an instance — so a universe holding no `Bool` instance is the
    // truthful description of this compiler, and reporting a collision against
    // an instance that never participates in selection would not be.
    const boolUnion = this.#preludeUnions.get("Bool");
    const channel: Resolved.PreludeInstance[] = [];
    const seen = new Set<string>();
    for (const [specifier, iface] of this.#preludeInterfaceBySpecifier) {
      for (const instance of iface.instances) {
        if (
          boolUnion !== undefined &&
          instance.subject.kind === "Union" &&
          instance.subject.union === boolUnion
        ) continue;
        // A prelude module's interface carries what it imported as well as what
        // it declared, so the same identity can arrive from two members. The
        // checker deduplicates by identity anyway; collapsing here keeps the
        // emitter's candidate set a set, so one dictionary cannot be imported
        // twice under two local names.
        if (seen.has(instance.identity)) continue;
        seen.add(instance.identity);
        channel.push({
          identity: instance.identity,
          constraint: instance.constraint,
          constraintIdentity: instance.constraintIdentity,
          typeParameters: instance.typeParameters,
          subject: instance.subject,
          impliedTypes: instance.impliedTypes,
          importedDictionary: instance.dictionary,
          // Unaliased, as in the explicit channel; `nameDictionaries` decides.
          localDictionary: instance.dictionary,
          derived: instance.derived,
          memberSeats: instance.memberSeats,
          // `specifier` above names the prelude member this instance was
          // *found* in, which the deduplication above may have settled on
          // ahead of the module that declares it; the seats are reached at the
          // declaration, so they take their own route (#444).
          ...this.#seatOrigin(instance.declaringPath),
          specifier,
          span,
        });
      }
    }
    return channel;
  }

  /**
   * What a term name means here, with Modules §5.4's reservation applied: in a
   * scope that declares the name over the prelude's binding of it, the prelude's
   * is invisible throughout, so this answers `undefined` above the declaration
   * and the ordinary top-down machinery takes over — Functions §7.2's
   * declared-later error, or §7.3's legal mutual reference inside a `fun`
   * block, which never reaches here because the block binds first. That is
   * the whole of "resolves as if the prelude did not bind the name", and it is
   * why one identifier cannot carry two meanings in one scope: without it a use
   * above the binder silently kept the prelude's.
   *
   * The one seam left open is the shadowing binder's **own RHS**. A `let`'s or
   * `var`'s own name is *pending* there — absent for reference, not yet bound
   * (Statements §5.1) — and the prelude's binding is exactly what it should
   * reach, since that is what makes the wrapping idiom work at either level:
   * `let show = (v) => "«" ++ show(v) ++ "»"` wraps the prelude's `show` once.
   *
   * Every scope on the stack is consulted, not just the innermost: a module-wide
   * occlusion reserves the name inside every function of the module too.
   */
  #lookupTerm(name: string, scope: Scope): Resolved.SymbolId | undefined {
    const symbol = scope.lookup(name);
    if (symbol === undefined || scope.lookupOwner(name) !== this.#preludeScope) return symbol;
    if (this.#findPending(name) !== undefined) return symbol;
    return this.#blockDeclarations.some((frame) => frame.reserved.has(name))
      ? undefined
      : symbol;
  }

  #findPending(
    name: string,
  ): { readonly name: Parsed.Name; readonly kind: "let" | "var" } | undefined {
    for (let index = this.#pending.length - 1; index >= 0; index -= 1) {
      const pending = this.#pending[index];
      if (pending?.name.text === name) return pending;
    }
    return undefined;
  }

  /**
   * Statements §5.1's pending clause: a name whose definition is in progress
   * counts as in scope for rule 1, so a sequential binder anywhere in the
   * pending binding's RHS may not claim it. Pending names come from `let`/`var`
   * LHSes (`#pending`) and from the honor-block member being resolved
   * (`#honorMembers` — a member is a `let` header, Constraints §4.6). Head
   * binders never reach this check (rule 2 extends over pending names).
   *
   * `existing` is what the ordinary in-scope lookup found, and it arbitrates
   * which collision the claimant actually has. The pending spelling being
   * *bound* does not by itself hand the collision to rule 1, because both
   * definition-in-progress forms occlude what the lookup can land on: a
   * member's spelling resolves to the constraint's own export (the
   * `constraint-member` symbol — prelude, imported, or same-module), and a
   * module-level `let`'s spelling can resolve to the prelude name the binding
   * occludes (Modules §5.4). In both shapes the nearest meaning is the
   * definition in progress, and this diagnostic — whose line N the author can
   * see — outranks rule 1's, whose "previous binding" would be a line in a
   * prelude file the author never opened. Anything else the lookup finds is a
   * genuine eclipse — a head binder shadowing the pending spelling, or an
   * ordinary binding an already-reported outer collision left standing — and
   * rule 1 owns it: the caller falls through to `#reportRebinding`.
   *
   * Answers whether it reported. On a hit the caller must still define the
   * refused binder — there is no meaning worth preserving over it, and defining
   * keeps later references resolving to what the source obviously intended
   * instead of cascading into the Functions §6 or Constraints §4.6
   * self-reference diagnostics (or, in the occluded-prelude shape, into a
   * phantom type error against the prelude's own type).
   */
  #reportPendingRebinding(
    name: Parsed.Name,
    existing: Resolved.SymbolId | undefined,
    scope: Scope,
  ): boolean {
    if (
      existing !== undefined &&
      this.#symbol(existing).kind !== "constraint-member" &&
      scope.lookupOwner(name.text) !== this.#preludeScope
    ) {
      return false;
    }
    const pending = this.#findPending(name.text);
    const member = this.#honorMembers.at(-1);
    const collision = pending !== undefined
      ? { span: pending.name.span, form: `the enclosing \`${pending.kind}\`` }
      : member?.text === name.text
      ? { span: member.span, form: "the enclosing member definition" }
      : undefined;
    if (collision === undefined) return false;
    this.#diagnostics.add({
      severity: "error",
      message: `\`${name.text}\` is already being defined by ${collision.form} ` +
        `(line ${collision.span.start.line + 1}); Hexagon does not allow ` +
        "rebinding — choose a different name.",
      primary: name.span,
      labels: [{ span: collision.span, message: "definition in progress" }],
    });
    return true;
  }


  /**
   * A constraint declaration's default member body, marked as such.
   *
   * The mark is the whole point: §4.6's reference laws govern honor blocks, and
   * a default lives in the declaration. Its member references reach whichever
   * instance completes it, at call time — an evidence route, which names no
   * binding, so a self-recursive default is as legal as it ever was.
   */
  #resolveDefaultBody(
    value: Parsed.LambdaExpr,
    scope: Scope,
    impliedContext?: { readonly owner: string; readonly names: ReadonlySet<string> },
  ): Resolved.LambdaExpr {
    this.#inDefaultBody = true;
    const resolved = this.#resolveLambda(value, scope, impliedContext);
    this.#inDefaultBody = false;
    return resolved;
  }

  /**
   * Constraints §4.6's ordering half, indexed before any body is resolved: for
   * each spelling this module's `honor` declarations bind, where each binding's
   * line is.
   *
   * A member definition **enters the module's top-down order at its own line**,
   * so a bare reference to one is legal exactly where any binding reference is:
   * after that line. The index is built from the parsed items because the law is
   * about text, and because a reference in the first honor block has to be able
   * to ask about the last one — which resolution has not reached yet.
   *
   * Three sources of member names per block, because the claim covers every
   * member the instance binds and not only the ones the block writes: the
   * written members, a locally declared constraint's list, and the compiler's
   * table for a pre-registered name. A defaulted member of an *imported* user
   * constraint is the residue, and it can only under-report — never refuse a
   * program §4.6 permits.
   *
   * A pre-registered constraint reached under an importer's alias joins that
   * same residue (#727): the index is built from *parsed* items, before any
   * import is resolved, so `derives (H)` has no identity to look the member
   * table up by and contributes nothing. Under-reporting again, and for the
   * structural reason rather than by choice — there is no identity in existence
   * at this point in the pass to key on.
   */
  #indexHonoredMemberLines(items: readonly Parsed.Item[]): void {
    const declared = new Map<string, readonly string[]>();
    for (const item of items) {
      if (item.kind !== "ConstraintDeclaration") continue;
      declared.set(
        item.name.text,
        item.members.map((member) => member.name.text),
      );
    }
    const record = (name: string, entry: HonoredMemberLine): void => {
      this.#honoredMemberLines.set(name, [
        ...this.#honoredMemberLines.get(name) ?? [],
        entry,
      ]);
    };
    for (const item of items) {
      if (item.kind === "Union" || item.kind === "RecordDeclaration") {
        for (const derive of item.derives) {
          for (const member of PRE_REGISTERED_CONSTRAINT_MEMBERS[derive.text] ?? []) {
            record(member, { constraint: derive.text, span: item.span });
          }
        }
        continue;
      }
      if (item.kind !== "Honor") continue;
      const constraint = item.constraint.text;
      const names = new Set([
        ...item.members.map((member) => member.name.text),
        ...declared.get(constraint) ?? [],
        ...PRE_REGISTERED_CONSTRAINT_MEMBERS[constraint] ?? [],
      ]);
      for (const name of names) {
        const written = item.members.find((member) => member.name.text === name);
        record(name, { constraint, span: written?.span ?? item.span });
        // §5.5's carve-out follows the **instance's completed member set** for a
        // block this module wrote — a member it omits is still bound here, as
        // the wrapper seat the emitter hoists for it (Constraints §2's defaults).
        // What the carve-out does not follow is `derives`, above: that clause
        // writes no block at all.
        this.#boundHonoredMembers.add(name);
      }
    }
  }

  /**
   * Constraints §4.6, at a bare reference to a spelling this module honors.
   *
   * Three refusals, all of them the law applied to one sentence — a member
   * definition is a module-level binding:
   *
   * - **Its own body cannot call its own name** (#293's non-`fun` law). The
   *   rewrite diagnostic names the sanctioned forms, and the qualified one only
   *   where it exists: a constraint declared in this module has no qualified
   *   spelling, because a module cannot name itself.
   * - **Two blocks binding one spelling** make the bare use genuinely ambiguous.
   *   The coexistence carve-out keeps both definitions legal; it is the bare
   *   *use* that is refused, naming the routes that are not ambiguous.
   * - **A reference above the binding's line** is the ordinary declared-later
   *   error — never "unknown name", which would be false.
   *
   * Evidence routes are not references and never reach here: interpolation, an
   * operator face, and a member-resolved dot call name no binding (Method Syntax
   * §4.4), which is what keeps mutually recursive instances legal in either
   * order.
   */
  #refusedMemberReference(name: Parsed.Name, symbol: Resolved.SymbolId): boolean {
    const declaration = this.#symbol(symbol);
    if (declaration.kind !== "constraint-member") return false;
    // A constraint *declaration's* default body is not an honor block. Its
    // member references — its own name included — reach the completed instance
    // through evidence, so none of the laws below governs them (§4.6's third
    // bullet, and Method Syntax §4.4's exemption for evidence routes).
    if (this.#inDefaultBody) return false;
    const bindings = this.#honoredMemberLines.get(name.text);
    if (bindings === undefined || bindings.length === 0) return false;
    if (this.#honorMembers.at(-1)?.text === name.text) {
      const qualified = this.#declaredConstraintNames.has(bindings[0]!.constraint)
        ? ""
        : `, or qualify the instance you mean: \`${bindings[0]!.constraint}.${name.text}(…)\``;
      this.#diagnostics.add({
        severity: "error",
        message: `\`${name.text}\` is this member's own name, and a member cannot ` +
          "call itself bare; recursion is spelled through dispatch — write the " +
          `dot call \`value.${name.text}()\`${qualified}`,
        primary: name.span,
      });
      return true;
    }
    // On the **declaring** module the polymorphic read wins (the note's
    // consequence 4): a module that declares a constraint and also honors it
    // holds the spelling twice on purpose, and bare use means the declaration's
    // export — ordered at the declaration's own line, which the ordinary
    // top-down machinery already governs. Only where the instance binding is the
    // spelling's one meaning do the two laws below have anything to say.
    if (Number(declaration.bindingSpan.fileId) === this.#fileId) return false;
    // Ambiguity is between **constraints**, never between instances. Two blocks
    // honoring one constraint at two of the module's types bind one declaration's
    // member twice, and evidence at the argument's type tells them apart — which
    // is what §4.6's carve-out means by "disambiguated by evidence". Two
    // *constraints* whose members share a spelling is the case with no such
    // discriminator, and it is the one refused.
    const constraints = [...new Set(bindings.map(({ constraint }) => constraint))];
    if (constraints.length > 1) {
      this.#diagnostics.add({
        severity: "error",
        message: `\`${name.text}\` is ambiguous here: this module binds it as a ` +
          `member of ${constraints.map((constraint) => `\`${constraint}\``).join(" and ")}. ` +
          "Write the dot call on a value, or qualify the instance you mean.",
        primary: name.span,
      });
      return true;
    }
    // A reference above **every** binding of the spelling is the ordinary
    // declared-later error — never "unknown name", which would be false.
    const earliest = bindings.reduce((first, binding) =>
      binding.span.start.offset < first.span.start.offset ? binding : first
    );
    if (name.span.start.offset < earliest.span.start.offset) {
      this.#diagnostics.add({
        severity: "error",
        message: `\`${name.text}\` is bound by the \`${earliest.constraint}\` instance ` +
          "below this use; declarations are read top-down — move the instance " +
          "above this use, or reach it through dispatch",
        primary: name.span,
        labels: [{ span: earliest.span, message: "the member is bound here" }],
      });
      return true;
    }
    return false;
  }

  /**
   * Consequence 4 of the members-as-values ruling, as Modules §5.3 graduates it:
   * **qualified access reaches an honoring module's members.**
   *
   * `Rat.add(r1, r2)` denotes `Num<Rat>`'s member; `Bool.show(flag)` denotes
   * derived `Show<Bool>`'s. The governing principle is uniform access — a
   * consumer's `M.f(…)` survives `f` migrating between a plain module function
   * and a constraint member, in either direction, with no call site changing —
   * which is why this read comes *after* `terms` and after the module's own
   * declared members, and never merges with either.
   *
   * Only instances at a type the module **declares**: an instance merely passing
   * through its import graph is not its member to offer. A module honoring one
   * constraint at several of its own types makes the spelling ambiguous and
   * takes §5.5's refusal posture, naming each honored type and the routes that
   * are not ambiguous.
   */
  /**
   * The same Modules §5.3 uniform-access read, for a **provided row** — an
   * instance no module's text declares (Collections Part 5 §4).
   *
   * `#honoredMemberAccess` above answers from `iface.instances`, which is built
   * from `honor` items, so it cannot answer here: the nine `Iterable` rows have
   * no source form at all (#353's ruling 1 — `Seq`'s would be a seat cycle and
   * `Vector`'s a structural head, both refused). What is *not* different is what
   * the reader is owed. `Vector.toSeq(v)` is the honored-member read of the row
   * at `Vector`, exactly as `Int.show(5)` is the read of `stdlib/Int.hex`'s
   * `honor Show<Int>`, and it stays a correct spelling now that the companions
   * no longer plain-export the name (Part 5 §2.3's sole-exporter bullet).
   *
   * Homed at the companion, never at `Iterable.hex`: `Iterable.toSeq` is the
   * *declaration's* qualified spelling and already answers through
   * `constraintMembers` one branch earlier, polymorphically. These pin the
   * subject, which is what makes `Map.toSeq(v)` at a vector a type error rather
   * than a synonym.
   *
   * `Range` has no row here because it has no companion module to home one at
   * (Part 5 §14.3 leaves `Range.toSeq` to the stdlib listing); the bare member
   * reaches a range perfectly well. `Array` is the same case one spec further
   * out — FFI Part 2 §9 names `Array.toSeq`, but no `Array.hex` exists to hang
   * it on yet.
   */
  #providedRowMemberAccess(
    iface: ModuleInterface,
    alias: string,
    field: Parsed.Name,
  ): Resolved.Expr | undefined {
    if (field.text !== "toSeq") return undefined;
    // The alias must be one a row is seated at before anything else is asked, so
    // that this reader and `#aliasOffers` answer the same set. The arms below
    // are the same five, and reaching the tail `return undefined` for an alias
    // this admitted would be the drift the shared constant exists to prevent.
    if (!PROVIDED_ROW_ALIASES.has(alias)) return undefined;
    // Keyed on the *module*, never on the spelling: a user's own
    // `import Vector from "./mine"` shadows the prelude alias, and the row
    // belongs to the prelude companion or to nothing.
    //
    // Compared by `fileId` rather than by object identity, because reaching the
    // same module two ways yields two interfaces. An explicit
    // `import Vector from "./stdlib/Vector"` of the very file the prelude
    // seated — what the Playground's hosted equipment does — resolves through
    // `#moduleAliases`, and identity would reject the module it is *about*.
    const companion = this.#preludeModuleAliases.get(alias);
    if (companion === undefined) return undefined;
    if (companion.module.fileId !== iface.module.fileId) return undefined;
    const declaring = this.#preludeModuleAliases.get("Iterable");
    const symbol = declaring?.constraintMembers.get("toSeq");
    if (symbol === undefined) return undefined;
    const local = this.#reachPreludeTerm(symbol.id);
    if (local === undefined) return undefined;
    const span = field.span;
    const variable = (name: string): Resolved.TypeAnnotation => ({
      kind: "TypeVariable",
      name,
      span,
    });
    const parameter = (name: string): Resolved.TypeParameter => ({
      name,
      constraints: [],
      span,
    });
    const pin = (
      annotation: Resolved.TypeAnnotation,
      names: readonly string[],
    ): Resolved.Expr => {
      this.#importedSymbols.set(symbol.id, symbol);
      return {
        kind: "Name",
        symbol: symbol.id,
        text: local,
        instanceSubject: { annotation, typeParameters: names.map(parameter) },
        span,
      };
    };
    if (alias === "Vector") {
      return pin({ kind: "Vector", element: variable("a"), span }, ["a"]);
    }
    if (alias === "Set") {
      return pin({ kind: "Set", element: variable("a"), span }, ["a"]);
    }
    if (alias === "Map") {
      return pin(
        { kind: "Map", key: variable("k"), value: variable("v"), span },
        ["k", "v"],
      );
    }
    if (alias === "String") {
      return pin({ kind: "Primitive", name: "String", span }, []);
    }
    if (alias === "Seq") {
      const record = iface.records.get("Seq");
      if (record === undefined) return undefined;
      return pin(
        {
          kind: "RecordDeclaration",
          record: record.id,
          name: "Seq",
          arguments: [variable("a")],
          span,
        },
        ["a"],
      );
    }
    return undefined;
  }

  /**
   * The instances `alias.field` could be reading, before any of the choosing:
   * every instance the module honors at a type it declares whose constraint has
   * a member of the name.
   *
   * Split out because two callers ask different questions of the same set —
   * `#honoredMemberAccess` below picks one or refuses an ambiguity, while
   * `#aliasOffers` only asks whether the surface has the name at all — and a
   * second derivation of "what §5.3 offers here" is exactly the drift that would
   * let one arm claim a binding the other cannot produce.
   */
  #honoredMemberCandidates(
    iface: ModuleInterface,
    field: string,
  ): readonly {
    readonly instance: InstanceInterface;
    readonly member: Resolved.ConstraintMember;
  }[] {
    // "A type it declares" — read for a **fixed prelude companion** as *the
    // primitive it companions* (Modules §5.3 as amended by #344; Constraints
    // §5.3 makes the companion the primitive's home module). `BigInt.gcd`
    // denotes `Integral<BigInt>`'s member exactly as `Rat.add` denotes
    // `Num<Rat>`'s, and the conversions ride the same read. The fact comes from
    // the module's compilation, not its text, so a user module honoring at a
    // primitive it does not companion is unaffected — as is the several-own-types
    // ambiguity refusal below, which a companion honoring at one type never meets.
    const declares = (subject: Resolved.TypeAnnotation): boolean =>
      (subject.kind === "RecordDeclaration" &&
        [...iface.records.values()].some(({ id }) => id === subject.record)) ||
      (subject.kind === "Union" &&
        [...iface.unions.values()].some(({ id }) => id === subject.union)) ||
      (subject.kind === "Primitive" &&
        subject.name === iface.module.companionPrimitive);
    return iface.instances.flatMap((instance) => {
      if (!declares(instance.subject)) return [];
      const declaration = iface.visibleConstraints.find(
        (item) => item.identity === instance.constraintIdentity,
      );
      const member = declaration?.members.find(
        ({ binding }) => binding.name === field,
      );
      if (member === undefined) return [];
      return [{ instance, member }];
    });
  }

  #honoredMemberAccess(
    iface: ModuleInterface,
    alias: string,
    field: Parsed.Name,
  ): Resolved.Expr | undefined {
    const candidates = this.#honoredMemberCandidates(iface, field.text);
    if (candidates.length === 0) return undefined;
    if (candidates.length > 1) {
      const types = candidates.map(({ instance }) => `\`${annotationHeadName(instance.subject)}\``);
      this.#diagnostics.add({
        severity: "error",
        message: `\`${alias}.${field.text}\` is ambiguous: \`${alias}\` honors a ` +
          `constraint with a member \`${field.text}\` at ${types.join(" and ")}. ` +
          `Write the dot call on a value of the type you mean, the bare ` +
          `\`${field.text}(…)\`, or the declaring module's qualified spelling.`,
        primary: field.span,
      });
      return { kind: "ErrorExpr", span: field.span };
    }
    const { instance, member } = candidates[0]!;
    const symbol = iface.module.symbols.find(({ id }) => id === member.binding.symbol);
    if (symbol === undefined) return undefined;
    this.#importedSymbols.set(symbol.id, symbol);
    // The member is the *declaring* module's binding, so the spelling this
    // module emits has to be one it can reach: the prelude local for a prelude
    // constraint, and otherwise **the alias's own qualified local** — which is
    // exactly the line the author already wrote, and the only spelling #762
    // leaves for a name smaller than a module (Modules §3, §5.3's uniform
    // access principle). The honored-member read is the whole reason `Rat.add`
    // and a user companion's `Box.size` mean the same thing, so declining here
    // for want of a named import would narrow the principle to the prelude.
    const local = this.#reachPreludeTerm(symbol.id) ?? `${alias}.${symbol.name}`;
    return {
      kind: "Name",
      symbol: symbol.id,
      text: local,
      instanceSubject: {
        annotation: instance.subject,
        typeParameters: instance.typeParameters,
      },
      span: field.span,
    };
  }

  /**
   * Consequence 3 of the constraint-members-are-values note (#335): **an
   * honored member's spelling is claimed in the honoring module's term space.**
   *
   * A member definition is a module-level binding. Hexagon has no overloading,
   * so a module that honors `Show<Box>` and also binds an ordinary `show` has
   * bound one name twice, and that is the rebinding error the language already
   * owns — no new rule, only a new pair of things that collide. The defect it
   * retires was writable and silent: a module could export `show(box) =
   * "export"` *while* honoring `Show<Box>` with `show(box) = "member"`, compile
   * clean, and split the spellings (a dot call and an in-module bare use took
   * the export; interpolation took the member).
   *
   * Three boundaries, each load-bearing:
   *
   * - **Members from distinct honor blocks coexist.** One module honoring two
   *   constraints that share a member name is legal and stays legal (note
   *   consequence 5), disambiguated by evidence, by qualification, or by
   *   Modules §5.5 where a bare use is genuinely ambiguous. That falls out of
   *   the claim being read against *bindings*: an honor block binds nothing in
   *   the module scope, so no claim can meet another claim.
   * - **A declaring module's own declaration is not an honor.** `Show.hex`
   *   binds `show` as a `constraint-member` of its declaration; a module that
   *   both declares and honors holds the spelling twice on purpose (note §5
   *   item 4), so a `constraint-member` binding is never the collision.
   * - **The claim covers every member of the constraint**, not the ones the
   *   block writes: a defaulted member the instance inherits is bound just as
   *   much as an overridden one, and a `derives` clause is honoring too.
   * - **An exported binding is refused in the checker, not here** (§4.6, #546).
   *   The claim is unconditional and no export is exempt, so the verdict is
   *   never in doubt; what the *message* needs is a signature, because an
   *   export that would have passed the door check earns the mechanical rewrite
   *   into the `widens` form (§4.7) — and signatures are not a question this
   *   pass can ask. So every exported module-level binding of a member's
   *   spelling passes here and `#refuseExportedMemberSpellings` refuses it
   *   there. Private bindings keep the whole refusal here, having no rewrite to
   *   be offered.
   * - **A `widens` declaration is not an ordinary binding** and is not the
   *   claim's business at all (§4.7): it is the spelling's one lawful bearer,
   *   its name derived from the member it names rather than written.
   *
   * Run once, after every item is resolved, which is what makes the claim
   * order-free — a `let` before the block and a `let` after it are the same
   * collision, and each is reported at whichever of the two the reader would
   * fix. Only the module layer: an inner-layer binder is refused by §5.4's
   * absolute ban long before it could reach here.
   */
  #claimHonoredMembers(items: readonly Resolved.Item[], scope: Scope): void {
    const exportedNames = new Set(
      items.flatMap((item) =>
        (item.kind === "Let" || item.kind === "Fun") && item.exported
          ? [item.binding.name]
          : []
      ),
    );
    // A `widens` binding wears the spelling lawfully (§4.7), and it is
    // `exported` besides, so it is out of the claim twice over. Named
    // explicitly all the same, because the two reasons are different and only
    // one of them is about visibility.
    for (const item of items) {
      if (item.kind === "Let" && item.widens !== undefined) {
        exportedNames.add(item.binding.name);
      }
    }
    for (const item of items) {
      if (item.kind !== "Honor") continue;
      const instance = `${item.constraint}<${annotationHeadName(item.subject)}>`;
      for (const member of this.#honoredMemberNames(item)) {
        if (exportedNames.has(member)) continue;
        const existing = scope.lookupLocal(member);
        if (existing === undefined) continue;
        const previous = this.#symbol(existing);
        if (previous.kind === "constraint-member") continue;
        const bound = previous.bindingSpan;
        const rebinding = "Hexagon does not allow rebinding — choose a different name.";
        const claimFirst = item.span.start.offset < bound.start.offset;
        this.#diagnostics.add({
          severity: "error",
          message: claimFirst
            ? `\`${member}\` is already bound: the \`${instance}\` instance binds it ` +
              `as a member (line ${item.span.start.line + 1}); ${rebinding}`
            : `the \`${instance}\` instance binds \`${member}\`, which is already ` +
              `bound (line ${bound.start.line + 1}); ${rebinding}`,
          primary: claimFirst ? bound : item.span,
          labels: claimFirst
            ? [{ span: item.span, message: "the member is bound here" }]
            : [{ span: bound, message: "previous binding" }],
        });
      }
    }
  }

  /**
   * Constraints §4.7's supply route, run once every item is resolved: the
   * members a `widens` declaration supplies are **derived** here, and every
   * refusal the pairing owes is reported here (#546).
   *
   * The derivation is the section's own sentence made mechanical — "the member
   * **is** the declaration's restriction, the door precomposed with the very
   * §5.1 conversions the signature check certified at each narrowed seat". The
   * synthesized body is the door called at the member's own seats; the
   * conversions are then the ordinary business of the seats that check that
   * call, which is what makes "one body, restricted mechanically" true of the
   * implementation and not only of the prose. Nothing about the pairing can be
   * asked before this point: `honor` may precede or follow the declaration it
   * accounts for (Declarations Preamble §7.2), so both halves have to be in
   * hand at once.
   */
  #supplyWidenedMembers(
    items: readonly Resolved.Item[],
  ): readonly Resolved.Item[] {
    const declarations = new Map<string, Resolved.LetItem>();
    const key = (identity: string, member: string): string => `${identity} ${member}`;
    let accounted = false;
    for (const item of items) {
      if (item.kind === "Honor") {
        accounted ||= item.members.some(({ derived }) => derived === true);
        continue;
      }
      if (item.kind !== "Let" || item.widens === undefined) continue;
      for (const target of item.widens) {
        declarations.set(key(target.constraintIdentity, target.member), item);
      }
    }
    // The overwhelming majority of modules hold neither half of a lawful pair,
    // and there is nothing this pass could say about one that holds neither.
    if (declarations.size === 0 && !accounted) return items;
    const honored = new Map<string, Resolved.HonorItem>();
    for (const item of items) {
      if (item.kind === "Honor") honored.set(item.constraintIdentity, item);
    }
    for (const item of items) {
      if (item.kind !== "Let" || item.widens === undefined) continue;
      this.#checkWidensHead(item, items, honored);
    }
    return items.map((item) => {
      if (item.kind !== "Honor") return item;
      // Asked of every block, accounting line or not: one with none still owes
      // one wherever a `widens` declaration supplies one of its members, since
      // absence keeps its exact current meanings only because the line is
      // required (§4.7).
      this.#reportMissingAccounting(item, declarations, key);
      if (!item.members.some(({ derived }) => derived === true)) return item;
      return {
        ...item,
        members: item.members.map((member) => {
          if (member.derived !== true) return member;
          const declaration = declarations.get(key(item.constraintIdentity, member.name));
          if (declaration === undefined) {
            this.#diagnostics.add({
              severity: "error",
              message:
                `\`${member.name} = widened\` accounts for a \`widens ` +
                `${item.constraint}.${member.name}\` declaration this module ` +
                "does not contain",
              primary: member.span,
            });
          }
          // On a refusal the member still takes the shape the block promised —
          // the right arity, an unresolvable body — so the one fault is
          // reported once and no arity or missing-member cascade follows it.
          return { ...member, value: this.#deriveMember(item, member, declaration) };
        }),
      };
    });
  }

  /**
   * The two head-level questions a `widens` declaration answers only once every
   * item is in hand: is each named member honored here, and are *all* the
   * same-spelled ones named (Constraints §4.7)?
   *
   * The all-or-none corner is a principle, not a convenience: a door widening
   * one of two same-spelled members would leave the other standing as a rival
   * binding of the same spelling — manufacturing exactly the rivalry the law
   * exists to exclude — so door-one-of-two is not expressible.
   */
  #checkWidensHead(
    item: Resolved.LetItem,
    items: readonly Resolved.Item[],
    honored: ReadonlyMap<string, Resolved.HonorItem>,
  ): void {
    const targets = item.widens ?? [];
    for (const target of targets) {
      if (honored.has(target.constraintIdentity)) continue;
      this.#diagnostics.add({
        severity: "error",
        message:
          `\`${target.module}.${target.member}\` is not a member this module ` +
          "honors at its own type",
        primary: target.span,
      });
    }
    // All-or-none has nothing to say about a head that did not resolve. A
    // declaration whose every path was refused lists no members at all, so the
    // loop below would find each honored one "not listed" and report the wrong
    // fault — "list it" is not the repair for a module alias that does not
    // exist. The unresolved head's own error leads instead, and the cascade
    // dies with it.
    if (targets.length === 0) return;
    const listed = new Set(targets.map(({ constraintIdentity }) => constraintIdentity));
    for (const honor of items) {
      if (honor.kind !== "Honor") continue;
      if (listed.has(honor.constraintIdentity)) continue;
      if (!this.#honoredMemberNames(honor).includes(item.binding.name)) continue;
      this.#diagnostics.add({
        severity: "error",
        message:
          `this module also honors \`${honor.constraint}\`, whose ` +
          `\`${item.binding.name}\` this declaration does not list — list it, or ` +
          "the binding cannot take this spelling",
        primary: targets[0]?.span ?? item.span,
        labels: [{ span: honor.span, message: "also honored here" }],
      });
      return;
    }
  }

  /**
   * The two ways a block and a `widens` declaration can fail to meet: a member
   * this module widens that the block never accounts for, and a member the
   * block *writes* beside the declaration — which is two implementations, the
   * rival §4.6 exists to exclude (§4.7).
   */
  #reportMissingAccounting(
    item: Resolved.HonorItem,
    declarations: ReadonlyMap<string, Resolved.LetItem>,
    key: (identity: string, member: string) => string,
  ): void {
    for (const name of this.#honoredMemberNames(item)) {
      const declaration = declarations.get(key(item.constraintIdentity, name));
      if (declaration === undefined) continue;
      const written = item.members.find(
        (member) => member.name === name && member.derived !== true,
      );
      if (written !== undefined) {
        this.#diagnostics.add({
          severity: "error",
          message:
            `\`${name}\` is supplied by this module's \`widens\` declaration ` +
            `(line ${declaration.span.start.line + 1}); a member written beside ` +
            "it would be a second implementation — account for it with " +
            `\`${name} = widened\``,
          primary: written.span,
          labels: [{ span: declaration.span, message: "the operation's one body" }],
        });
        continue;
      }
      if (item.members.some((member) => member.name === name)) continue;
      this.#diagnostics.add({
        severity: "error",
        message:
          `this instance does not account for \`${name}\`, which this module's ` +
          `\`widens\` declaration supplies (line ${declaration.span.start.line + 1}) ` +
          `— write \`${name} = widened\` in the block`,
        primary: item.span,
      });
    }
  }

  /**
   * One derived member: the door, called at the member's own seats.
   *
   * Nothing here decides a conversion. The call's arguments arrive with the
   * *member's* parameter types and land in the *door's* seats, so Numeric
   * Literals §5.1's exact conversions are inserted by the same seat check that
   * inserts them anywhere else — the very ones the signature check certified.
   * That is the whole of "derived, not written": the behavioural law holds
   * because one body is restricted mechanically and agrees with itself.
   */
  #deriveMember(
    item: Resolved.HonorItem,
    member: Resolved.HonorMember,
    declaration: Resolved.LetItem | undefined,
  ): Resolved.LambdaExpr {
    const constraint = this.#visibleConstraints.get(item.constraintIdentity) ??
      this.#namedConstraint(item.constraint);
    const required = constraint?.members.find(({ binding }) => binding.name === member.name);
    const span = member.span;
    const parameters = (required?.parameters ?? []).map((parameter, index) =>
      this.#declare(
        {
          text: parameter.name === "" ? `argument${index}` : parameter.name,
          startClass: "non-upper",
          span,
        },
        "parameter",
      )
    );
    if (declaration === undefined) {
      return {
        kind: "Lambda",
        parameters,
        body: { kind: "ErrorExpr", span },
        span,
      };
    }
    return {
      kind: "Lambda",
      parameters,
      body: {
        kind: "Call",
        callee: {
          kind: "Name",
          symbol: declaration.binding.symbol,
          text: declaration.binding.name,
          span,
        },
        arguments: parameters.map((parameter) => ({
          kind: "Name" as const,
          symbol: parameter.symbol,
          text: parameter.name,
          span,
        })),
        span,
      },
      span,
    };
  }

  /**
   * A `widens` head's member paths, resolved (Constraints §4.7, #546).
   *
   * The qualification is **module-alias qualification, the only kind there is**
   * (§2.2), and that is exactly what makes the reach doctrine self-enforce: the
   * constraint's own declaring module cannot qualify through itself, and a
   * named constraint import binds no alias, so at both boundaries the head has
   * no spelling at all and the law is never consulted (§4.6, Modules §3.1).
   *
   * A path naming no member is refused here, in the ordinary
   * unknown-qualified-name words. A path whose *qualifier* names nothing is the
   * not-yet-imported author's front door (#577, Constraints §8's row): the
   * refusal carries the route, because "unknown module" alone leaves a writer
   * who has read §5.3 with no next move, and the next move is one import line.
   * Whether the module *honors* the constraint at
   * its own type cannot be asked yet — an `honor` block may stand below this
   * line — so `#checkWidensDeclarations` asks it once every item is resolved.
   */
  #resolveWidensHead(
    targets: readonly Parsed.WidensTarget[],
  ): readonly Resolved.WidensTarget[] {
    return targets.flatMap((target): Resolved.WidensTarget[] => {
      const iface = this.#namedModule(target.module.text);
      if (iface === undefined) {
        this.#diagnostics.add({
          severity: "error",
          message: `unknown module \`${target.module.text}\`; a \`widens\` head ` +
            "names its member through a module alias; import the member's home " +
            `module under the alias \`${target.module.text}\``,
          primary: target.module.span,
          importModuleRepair: { name: target.module.text, namespace: "constraint" },
        });
        return [];
      }
      const owner = [...iface.constraints.values()].find((declaration) =>
        declaration.members.some(({ binding }) => binding.name === target.member.text)
      );
      if (owner === undefined) {
        this.#diagnostics.add({
          severity: "error",
          message:
            `\`${target.module.text}.${target.member.text}\` is not a constraint ` +
            `member; a \`widens\` head names one`,
          primary: target.span,
        });
        return [];
      }
      return [{
        module: target.module.text,
        constraint: owner.name,
        constraintIdentity: owner.identity,
        member: target.member.text,
        span: target.span,
      }];
    });
  }

  /**
   * The member names an `honor` binds: the constraint's declaration, wherever
   * it is visible from — this module's own, an imported one, or a prelude one
   * riding the visible-constraints metadata channel.
   *
   * The fallback is for a compile with no prelude at all (the pass-level unit
   * harnesses), where a pre-registered name still means the compiler's
   * constraint but no declaration is in view. See
   * `PRE_REGISTERED_CONSTRAINT_MEMBERS` for why answering from a table there is
   * better than answering from the honor block's own member list, which would
   * silently let an inherited default's spelling escape the claim.
   */
  #honoredMemberNames(item: Resolved.HonorItem): readonly string[] {
    const declaration = this.#visibleConstraints.get(item.constraintIdentity) ??
      this.#namedConstraint(item.constraint);
    if (declaration !== undefined) {
      return declaration.members.map(({ binding }) => binding.name);
    }
    return PRE_REGISTERED_CONSTRAINT_MEMBERS[item.constraint] ?? [];
  }

  /**
   * Constraints §6.1's member seats, one per member of every **ground**
   * instance this module declares, under their preferred spellings (#444).
   *
   * Run once, immediately before `nameDictionaries`, because it needs exactly
   * what that pass needs: every declaration resolved, so the constraint behind
   * each `honor` is in view. The member list is the constraint declaration's —
   * `#honoredMemberNames`, the same enumeration §4.6's spelling claim already
   * runs on — which is what makes the seat set the instance's *completed* one:
   * an inherited default has no line in the block to be read off, and a derived
   * instance has no lines at all, yet §2's completed member set holds both and
   * §4.6 qualifies `Int.notEquals` either way.
   *
   * "Ground" is the emitter's own test, spelled the way emission spells it: an
   * instance takes an evidence parameter per (binder, constraint) pair, so an
   * instance with no such pair is a record and every other one is a factory. A
   * factory's members close over its parameters and so cannot hoist (§6.1's
   * parameterized bullet), which is why those instances get no seats here.
   */
  #assignMemberSeats(items: readonly Resolved.Item[]): readonly Resolved.Item[] {
    return items.map((item) => {
      if (item.kind !== "Honor") return item;
      if (item.typeParameters.some(({ constraints }) => constraints.length > 0)) {
        return item;
      }
      const members = this.#honoredMemberNames(item);
      if (members.length === 0) return item;
      return {
        ...item,
        memberSeats: members.map((member) => ({
          member,
          seat: memberSeatName(item.dictionary, member),
        })),
      };
    });
  }

  /**
   * Where an imported instance's member seats are reached from **here**: the
   * declaring module's path, carried on unchanged, plus that path as an import
   * specifier from this module (#444).
   *
   * Both are absent together, and the compilation that has neither is the one
   * that gave no module a path — the pass-level harnesses. Routing a concrete
   * member call across a module boundary then has no specifier to write, so it
   * declines and the call keeps its forwarder, which is the shape those
   * harnesses measured before this existed.
   */
  #seatOrigin(declaringPath: string | undefined): {
    readonly declaringPath?: string;
    readonly seatSpecifier?: string;
  } {
    if (declaringPath === undefined || this.#path === undefined) return {};
    return {
      declaringPath,
      seatSpecifier: relativeSpecifier(this.#path, declaringPath),
    };
  }

  /**
   * Rule 1's refusal, plus the collisions that have a repair to teach.
   *
   * The named-import arm this report once carried is **gone with the form**
   * (#762): a member could arrive in bare scope only through a named
   * constraint import, and no import binds a name smaller than a module, so
   * the would-be-door collision — an exported binding over an arrived member's
   * spelling — has no way to arise and needs no route out. Every collision
   * here is now an ordinary rebinding or a `widens` one.
   *
   * `widens` is read for the rest (Constraints §4.7, #546), and what it changes
   * is which name the repair can point at. **A `widens` declaration has no name
   * to choose**: the binding's spelling is derived from the member it names, so
   * "choose a different name" is advice the author cannot take, and every
   * message this pass gives a `widens` head has to name a different repair —
   * the other binding, the other declaration, or the import that must go.
   */
  #reportRebinding(
    name: Parsed.Name,
    existing: Resolved.SymbolId,
    widens = false,
  ): void {
    const previous = this.#symbol(existing);
    const line = previous.bindingSpan.start.line + 1;
    if (widens) {
      // Two declarations of one member necessarily share the derived spelling,
      // which is the rivalry §4.7 exists to exclude — one operation has one
      // written body — and the only repair is that one of them goes. Against an
      // *ordinary* prior binding the claim is untouched (§4.6's boundary): the
      // declaration still cannot unseat it, and the binding is the end that can
      // be renamed.
      this.#diagnostics.add({
        severity: "error",
        message:
          `\`${name.text}\` is already bound (line ${line}); ` +
          (previous.widens === true
            ? "one operation has one written body, and a `widens` declaration's " +
              "name is derived from the member it names — there is no other " +
              "name for either to take, so one of the two declarations must go."
            : "a `widens` declaration's name is derived from the member it " +
              `names and cannot be chosen — rename the binding on line ${line}, ` +
              "or drop this declaration."),
        primary: name.span,
        labels: [{ span: previous.bindingSpan, message: "previous binding" }],
      });
      return;
    }
    this.#diagnostics.add({
      severity: "error",
      message:
        `\`${name.text}\` is already bound (line ${line}); Hexagon does not ` +
        "allow rebinding — choose a different name.",
      primary: name.span,
      labels: [{ span: previous.bindingSpan, message: "previous binding" }],
    });
  }

  #symbol(id: Resolved.SymbolId): Resolved.Symbol {
    const symbol = this.#symbols.get(id) ?? this.#importedSymbols.get(id);
    if (symbol === undefined) throw new Error(`unknown internal symbol ${id}`);
    return symbol;
  }
}

function isPrimitiveName(name: string): name is Resolved.PrimitiveName {
  return ["Nat", "Int", "Float", "String", "BigInt", "Exn", "Unit"].includes(name);
}

function isResolvedTypeAlias(
  alias: Parsed.TypeAliasItem | Resolved.TypeAliasItem,
): alias is Resolved.TypeAliasItem {
  return typeof alias.name === "string";
}

/**
 * The prelude companions a **provided `Iterable` row** is seated at (Collections
 * Part 5 §4), by the alias that names them.
 *
 * The row has no source form to read the set off — that is what makes it
 * *provided* — so the set is written once here and consulted by both readers:
 * `#providedRowMemberAccess`, which pins the subject each one rides, and
 * `#aliasOffers`, which asks only whether the alias offers `toSeq` at all. Two
 * derivations would drift the moment one grew an entry, and the drift is not
 * symmetric: the offer side over-claiming means a `toSeq` above an import draws
 * "move the import above this use" for a member moving it does not reach, which
 * is the promise Modules §3 scopes to what an import *binds*.
 *
 * Every prelude basename a project file may take (`injectEmbedded`) is an alias
 * this question can be asked at — `Int`, `Debug`, and the rest are seated files
 * too — so the guard cannot be the seating alone.
 */
export const PROVIDED_ROW_ALIASES: ReadonlySet<string> = new Set([
  "Vector",
  "Set",
  "Map",
  "String",
  "Seq",
]);

/**
 * The **open unions** of the prelude (Modules §5.5, #742): the three whose
 * constructors are seeded into a consumer's bare term scope, in expressions and
 * in patterns alike.
 *
 * The list inverts the sense of the one it replaces. Until #742 the compiler
 * held the *hidden* unions — `spec/ffi.md` §12's four boundary utilities, whose
 * constructors were qualified-only against a bare-by-default rule. The default
 * is now qualified-only for every prelude union, so §12's four fall out with no
 * entry anywhere and this list carries the exceptions instead: `Bool`,
 * `Option`, `Result` — the Rust carve, six names.
 *
 * `Ordering` is deliberately absent (ruling 2). Its constructors are matched
 * rarely, because `<`, `==` and `>` already carry the comparison vocabulary, so
 * `Ordering.Less` costs little where it is written — and `stdlib/Ordering.hex`
 * exists to be the module that spelling names (Modules §3.3).
 *
 * The designation is the compiler's, because there is no source form for it and
 * there is deliberately none: bare seeding is a fact about *this inventory*, not
 * a property a declaration can claim. A user's own union spelled `Option` is
 * untouched — this list is consulted only while seeding the prelude.
 */
const OPEN_PRELUDE_UNIONS: ReadonlySet<string> = new Set([
  "Bool",
  "Option",
  "Result",
]);

/**
 * The **pervasive term** of the prelude's function channel (Modules §5.5, #742) —
 * the one ordinary binding seeded bare — keyed by the exporting module's basename
 * *and* the name, so that a same-spelled export somewhere else in the prelude
 * never rides in on this entry.
 *
 * `ignore` is here on its own ground: Statements §3.2's discard diagnostic names
 * the bare spelling as its own rewrite, and nobody declares the word. Nothing
 * else is, and the entry is not a precedent.
 */
const PERVASIVE_PRELUDE_TERMS: ReadonlySet<string> = new Set([
  "Prelude.ignore",
]);

/**
 * The **pervasive constraint member** (Modules §5.5, #742), keyed by its
 * declaration's *identity* rather than by any spelling: `show` is bare because
 * `Show.hex`'s declaration is the one seeding it, so a second constraint
 * declaring a member spelled `show` seeds nothing and the collided-name rule
 * never meets a second exporter.
 *
 * It is on the list "only for teachability purposes" (James, ruling 4) — the
 * display idiom the book teaches bare, dot, and qualified in equal measure — and
 * that ground is explicitly not a precedent. Every other member is reached by
 * the dot where it is subject-first, and qualified always.
 */
const PERVASIVE_PRELUDE_MEMBERS: ReadonlyMap<string, string> = new Map([
  [preRegisteredConstraintIdentity("Show"), "show"],
]);

/**
 * The identities of the constraints whose instances at structural types are
 * automatic (`STRUCTURAL_CONSTRAINTS`), for `PreludeRoute.structural`.
 *
 * Derived from the one inventory rather than transcribed, so a constraint
 * joining or leaving the structural set carries this reading with it; and held
 * as identities rather than names, so that only the prelude's own declarations
 * answer to it.
 */
const STRUCTURAL_CONSTRAINT_IDENTITIES: ReadonlySet<string> = new Set(
  STRUCTURAL_CONSTRAINTS.map(preRegisteredConstraintIdentity),
);

/**
 * The operations a primitive companion is asked for and deliberately does not
 * have, with the sentence that says why (Integral §8's diagnostics row).
 *
 * A name-not-found hint is cheap, and this one is worth its keep: the obvious
 * hand-rolled `a * b / gcd(a, b)` at `Int` overflows the safe range for
 * ordinary inputs, silently, which is exactly the mistake the missing member is
 * refusing to make. The row survived the re-homing (#344) — the spelling now
 * misses as an ordinary does-not-export at a real module rather than at the
 * wired route — because the obligation is the row, not the mechanism that
 * carried it.
 */
const CURATED_COMPANION_MISSES: ReadonlyMap<string, string> = new Map([
  [
    "Int.lcm",
    "`Int` has no `lcm` — its results overflow `Int`'s safe range for ordinary " +
      "inputs; use `BigInt.lcm`",
  ],
]);

function curatedCompanionMiss(
  companion: string | undefined,
  field: string,
): string | undefined {
  return companion === undefined
    ? undefined
    : CURATED_COMPANION_MISSES.get(`${companion}.${field}`);
}

/** One `honor` declaration's binding of one member spelling (Constraints §4.6). */
interface HonoredMemberLine {
  readonly constraint: string;
  readonly span: Source.Span;
}

function annotationHeadName(annotation: Resolved.TypeAnnotation): string {
  switch (annotation.kind) {
    case "Primitive": return annotation.name;
    case "Range": return "Range";
    case "Vector": return "Vector";
    case "Map": return "Map";
    case "Set": return "Set";
    case "Array": return "Array";
    case "JsMap": return "JsMap";
    case "JsSet": return "JsSet";
    case "JsValue": return "JsValue";
    case "Node": return "Node";
    case "Nullable": return "Nullable";
    case "Function": return "Function";
    case "Union": return annotation.name;
    case "RecordDeclaration": return annotation.name;
    case "ExternType": return annotation.name;
    case "Tuple": return "Tuple";
    case "Record": return "Record";
    case "TypeVariable": return annotation.name;
    case "ImpliedType": return annotation.name;
    case "Hole": return "_";
    case "ErrorType": return "Error";
  }
}

function annotationTypeVariables(annotation: Resolved.TypeAnnotation): readonly string[] {
  switch (annotation.kind) {
    case "TypeVariable": return [annotation.name];
    case "Vector": return annotationTypeVariables(annotation.element);
    case "Set": return annotationTypeVariables(annotation.element);
    case "Array": return annotationTypeVariables(annotation.element);
    case "JsSet": return annotationTypeVariables(annotation.element);
    case "Node": return annotationTypeVariables(annotation.element);
    case "Nullable": return annotationTypeVariables(annotation.value);
    case "Map":
    case "JsMap": return [
      ...annotationTypeVariables(annotation.key),
      ...annotationTypeVariables(annotation.value),
    ];
    case "Function": return [
      ...annotation.parameters.flatMap(annotationTypeVariables),
      ...annotationTypeVariables(annotation.result),
    ];
    case "Tuple": return annotation.elements.flatMap(annotationTypeVariables);
    case "Record": return annotation.fields.flatMap((field) =>
      annotationTypeVariables(field.annotation)
    );
    case "Union":
    case "RecordDeclaration":
      return annotation.arguments.flatMap(annotationTypeVariables);
    case "ExternType":
    case "Primitive":
    case "Range":
    case "JsValue":
    case "ImpliedType":
    // A hole names no variable: it claims no shape and links nothing (closure
    // doc §2.3), so it contributes no name to any declaration head's inventory.
    case "Hole":
    case "ErrorType":
      return [];
  }
}

function parsedAnnotationTypeVariables(annotation: Parsed.TypeAnnotation): ReadonlySet<string> {
  const names = new Set<string>();
  const visit = (type: Parsed.TypeAnnotation): void => {
    if (type.kind === "TypeVariable") names.add(type.name.text);
    else if (type.kind === "Tuple") type.elements.forEach(visit);
    else if (type.kind === "Record") type.fields.forEach((field) => visit(field.annotation));
    else if (type.kind === "AppliedType") type.arguments.forEach(visit);
    else if (type.kind === "Function") {
      type.parameters.forEach(visit);
      visit(type.result);
    }
  };
  visit(annotation);
  return names;
}

function withTypeSpan(type: Resolved.TypeAnnotation, span: Source.Span): Resolved.TypeAnnotation {
  // A substituted type is re-pointed at the position it was substituted *into*,
  // so a diagnostic about an alias body carets the alias body. A hole keeps its
  // own span instead: the `_` the user wrote is the only thing hover can point
  // at, and an alias body has no `_` in it to caret (§5.4 fences one out).
  if (type.kind === "Hole") return type;
  return { ...type, span };
}

function substituteResolvedType(
  type: Resolved.TypeAnnotation,
  replacements: ReadonlyMap<string, Resolved.TypeAnnotation>,
  span = type.span,
): Resolved.TypeAnnotation {
  if (type.kind === "Hole") return type;
  if (type.kind === "TypeVariable") return withTypeSpan(replacements.get(type.name) ?? type, span);
  if (type.kind === "Tuple") return { ...type, elements: type.elements.map((element) => substituteResolvedType(element, replacements)), span };
  if (type.kind === "Record") return {
    ...type,
    fields: type.fields.map((field) => ({ ...field, annotation: substituteResolvedType(field.annotation, replacements) })),
    span,
  };
  if (type.kind === "Vector" || type.kind === "Set" || type.kind === "Array" || type.kind === "JsSet") {
    return { ...type, element: substituteResolvedType(type.element, replacements), span };
  }
  if (type.kind === "Nullable") return { ...type, value: substituteResolvedType(type.value, replacements), span };
  if (type.kind === "Map" || type.kind === "JsMap") return {
    ...type,
    key: substituteResolvedType(type.key, replacements),
    value: substituteResolvedType(type.value, replacements),
    span,
  };
  if (type.kind === "Function") return {
    ...type,
    parameters: type.parameters.map((parameter) =>
      substituteResolvedType(parameter, replacements)
    ),
    result: substituteResolvedType(type.result, replacements),
    span,
  };
  if (type.kind === "Union" || type.kind === "RecordDeclaration") {
    return { ...type, arguments: type.arguments.map((argument) => substituteResolvedType(argument, replacements)), span };
  }
  return { ...type, span };
}

/**
 * A resolved type with every linked arrow turned into the impure constant.
 *
 * Error recovery for an alias body §5.1.1 has already refused (Effects §4.4).
 * The arrow denotes nothing, and leaving it `"linked"` would let it acquire a
 * meaning at a use site that happens to offer an inlet — so it takes the
 * constant, which is what the writer is being told to write.
 */
function constantifyLinkedArrows(annotation: Resolved.TypeAnnotation): Resolved.TypeAnnotation {
  const rebuild = (node: unknown): unknown => {
    if (node === null || typeof node !== "object") return node;
    if (Array.isArray(node)) return node.map(rebuild);
    const record = node as Record<string, unknown>;
    const copy: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(record)) {
      copy[key] = key === "span" || key === "arrowSpan" ? child : rebuild(child);
    }
    if (copy.kind === "Function" && copy.effect === "linked") copy.effect = "constant";
    return copy;
  };
  return rebuild(annotation) as Resolved.TypeAnnotation;
}
